import { NextResponse } from 'next/server';

import { db } from '@/core/database/client';
import {
  whatsappChannels,
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
} from '@/core/database/schema';
import { eq, and } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';
import { normalizeMetaStatus } from '@/core/whatsapp/templates/metaStatus';

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const seenEvents = new Map<string, number>();

function safeTimingEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function cleanupSeenEvents(now: number): void {
  for (const [key, expiresAt] of seenEvents.entries()) {
    if (expiresAt <= now) {
      seenEvents.delete(key);
    }
  }
}

function parseYCloudSignature(signatureHeader: string | null): { timestamp: string | null; signature: string | null } {
  if (!signatureHeader) return { timestamp: null, signature: null };

  const parts = signatureHeader.split(',').map((part) => part.trim());
  const kv = new Map<string, string>();
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    if (!key || rest.length === 0) continue;
    kv.set(key.trim().toLowerCase(), rest.join('=').trim());
  }

  const timestamp = kv.get('t') ?? null;
  const signature = kv.get('s') ?? null;

  return { timestamp, signature };
}

function verifyYCloudSignature(rawBody: string, signatureHeader: string | null): { ok: boolean; reason?: string } {
  const secret = env.ycloudWebhookSecret;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: 'Missing YCLOUD_WEBHOOK_SECRET' };
    }
    return { ok: true };
  }

  const { timestamp, signature } = parseYCloudSignature(signatureHeader);
  if (!signature) {
    return { ok: false, reason: 'Missing signature in YCloud-Signature header' };
  }

  if (!timestamp) {
    return { ok: false, reason: 'Missing timestamp in YCloud-Signature header' };
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: 'Invalid timestamp format' };
  }

  // Convert to milliseconds if timestamp is in seconds
  const timestampMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const now = Date.now();

  // Replay protection: reject if timestamp is older than 5 minutes
  if (Math.abs(now - timestampMs) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'Expired signature timestamp' };
  }

  // Verify HMAC-SHA256: signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  if (!safeTimingEquals(signature, expectedSignature)) {
    return { ok: false, reason: 'Invalid signature' };
  }

  return { ok: true };
}

// YCloud webhook payload types
interface YCloudMessage {
  id: string;
  type: string;
  from?: string;
  timestamp?: string | number;
  text?: { body: string };
  template?: {
    name: string;
    components?: { parameters?: { text?: string }[] }[];
  };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
  audio?: { caption?: string };
  interactive?: {
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
  context?: { from?: string };
  status?: string;
  pricing?: { price?: string; currency?: string };
  errors?: { code?: string; title?: string }[];
}

interface YCloudPhoneNumber {
  id: string;
  display_phone_number?: string;
  quality_rating?: string;
  status?: string;
}

interface YCloudContact {
  wa_id?: string;
  profile?: { name?: string };
}

interface YCloudPayload {
  id?: string;
  type?: string;
  createTime?: number;
  message?: YCloudMessage;
  phone_number?: YCloudPhoneNumber;
  contact?: YCloudContact;
  template?: { id: string; status: string };
}

type InboundMessageType = 'text' | 'template' | 'media' | 'interactive';

async function handleInboundMessageReceived(payload: YCloudPayload): Promise<void> {
  const messageData = payload.message;
  const phoneNumberData = payload.phone_number;
  const contactData = payload.contact;

  if (!messageData || !phoneNumberData) {
    console.warn('[ycloud-webhook] Inbound message missing message or phone_number data');
    return;
  }

  const ycloudPhoneNumberId = phoneNumberData.id;
  const ycloudMessageId = messageData.id;
  const direction = 'inbound' as const;
  const type = (messageData.type as InboundMessageType) ?? 'text';
  const timestamp = messageData.timestamp ? Number(messageData.timestamp) : Date.now() / 1000;

  const channel = await findChannelByPhoneNumberId(ycloudPhoneNumberId);
  if (!channel) return;

  const channelId = channel.id;
  const businessId = channel.businessId;

  const customerPhone = contactData?.wa_id ?? messageData.from ?? '';
  const customerName = contactData?.profile?.name;
  const metaBsuId = messageData.context?.from;

  const conversationId = await upsertConversation(channelId, customerPhone, customerName, metaBsuId, timestamp);

  const { body, templateName } = extractMessageBody(type, messageData);

  await insertInboundMessage({
    conversationId,
    channelId,
    direction,
    type,
    templateName,
    body,
    ycloudMessageId,
    timestamp,
  });

  console.warn(
    `[ycloud-webhook] Inbound message from ${customerPhone} to business ${businessId} (channel: ${channelId}): ${body?.slice(0, 100)}`,
  );
}

async function findChannelByPhoneNumberId(ycloudPhoneNumberId: string) {
  const channel = await db
    .select()
    .from(whatsappChannels)
    .where(eq(whatsappChannels.ycloudPhoneNumberId, ycloudPhoneNumberId))
    .limit(1);

  if (!channel.length) {
    console.warn(`[ycloud-webhook] Channel not found for ycloudPhoneNumberId: ${ycloudPhoneNumberId}`);
    return null;
  }
  return channel[0];
}

async function upsertConversation(
  channelId: string,
  customerPhone: string,
  customerName: string | undefined,
  metaBsuId: string | undefined,
  timestamp: number,
): Promise<string> {
  const whereClause = metaBsuId
    ? and(
        eq(whatsappConversations.channelId, channelId),
        eq(whatsappConversations.metaBsuId, metaBsuId),
        eq(whatsappConversations.status, 'active'),
      )
    : and(
        eq(whatsappConversations.channelId, channelId),
        eq(whatsappConversations.customerPhone, customerPhone),
        eq(whatsappConversations.status, 'active'),
      );

  const existingConv = await db
    .select()
    .from(whatsappConversations)
    .where(whereClause)
    .limit(1);

  if (existingConv.length > 0) {
    const conversationId = existingConv[0].id;
    await db
      .update(whatsappConversations)
      .set({ lastMessageAt: new Date(timestamp * 1000), updatedAt: new Date() })
      .where(eq(whatsappConversations.id, conversationId));
    return conversationId;
  }

  const newConv = await db
    .insert(whatsappConversations)
    .values({
      channelId,
      customerPhone,
      customerName,
      metaBsuId,
      lastMessageAt: new Date(timestamp * 1000),
      status: 'active',
    })
    .returning({ id: whatsappConversations.id });

  return newConv[0].id;
}

function extractMessageBody(
  type: 'text' | 'template' | 'media' | 'interactive',
  messageData: YCloudMessage,
): { body: string | null; templateName?: string } {
  let body: string | null = null;
  let templateName: string | undefined;

  switch (type) {
    case 'text':
      body = messageData.text?.body ?? '';
      break;
    case 'template':
      templateName = messageData.template?.name;
      body = messageData.template?.components?.[0]?.parameters?.[0]?.text ?? '';
      break;
    case 'media':
      body =
        (messageData.image?.caption as string) ??
        (messageData.video?.caption as string) ??
        (messageData.document?.caption as string) ??
        (messageData.audio?.caption as string) ??
        '';
      break;
    case 'interactive':
      body = messageData.interactive?.button_reply?.title ?? messageData.interactive?.list_reply?.title ?? '';
      break;
    default:
      body = JSON.stringify(messageData);
  }

  return { body, templateName };
}

async function insertInboundMessage(params: {
  conversationId: string;
  channelId: string;
  direction: 'inbound';
  type: 'text' | 'template' | 'media' | 'interactive';
  templateName: string | undefined;
  body: string | null;
  ycloudMessageId: string;
  timestamp: number;
}): Promise<void> {
  await db.insert(whatsappMessages).values({
    conversationId: params.conversationId,
    channelId: params.channelId,
    direction: params.direction,
    type: params.type,
    templateName: params.templateName,
    body: params.body,
    ycloudMessageId: params.ycloudMessageId,
    status: 'accepted',
    createdAt: new Date(params.timestamp * 1000),
  });
}

async function handleMessageUpdated(payload: YCloudPayload): Promise<void> {
  const messageData = payload.message;
  if (!messageData) {
    console.warn('[ycloud-webhook] Message updated event missing message data');
    return;
  }

  const ycloudMessageId = messageData.id;
  const status = (messageData.status as 'accepted' | 'sent' | 'delivered' | 'read' | 'failed') ?? 'accepted';
  const metaPrice = messageData.pricing?.price;
  const metaCurrency = messageData.pricing?.currency;
  const errorCode = messageData.errors?.[0]?.code;
  const errorMessage = messageData.errors?.[0]?.title;

  await db
    .update(whatsappMessages)
    .set({
      status,
      metaPrice,
      metaCurrency,
      errorCode,
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(whatsappMessages.ycloudMessageId, ycloudMessageId));

  console.warn(`[ycloud-webhook] Message ${ycloudMessageId} status updated to ${status}`);
}

async function handleTemplateReviewed(payload: YCloudPayload): Promise<void> {
  const templateData = payload.template;
  if (!templateData) {
    console.warn('[ycloud-webhook] Template reviewed event missing template data');
    return;
  }

  const metaTemplateId = templateData.id;
  // YCloud webhooks send UPPERCASE statuses ('APPROVED') — persist lowercase.
  const metaStatus = normalizeMetaStatus(templateData.status);

  await db
    .update(whatsappTemplates)
    .set({
      metaStatus,
      metaTemplateId,
      updatedAt: new Date(),
    })
    .where(eq(whatsappTemplates.metaTemplateId, metaTemplateId));

  console.warn(`[ycloud-webhook] Template ${metaTemplateId} status: ${metaStatus}`);
}

async function handlePhoneNumberUpdated(payload: YCloudPayload): Promise<void> {
  const phoneNumberData = payload.phone_number;
  if (!phoneNumberData) {
    console.warn('[ycloud-webhook] Phone number updated event missing phone_number data');
    return;
  }

  const ycloudPhoneNumberId = phoneNumberData.id;
  const displayPhoneNumber = phoneNumberData.display_phone_number;
  const status = phoneNumberData.status;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (displayPhoneNumber) updates.displayPhoneNumber = displayPhoneNumber;
  if (status) updates.isActive = status === 'connected';

  await db
    .update(whatsappChannels)
    .set(updates)
    .where(eq(whatsappChannels.ycloudPhoneNumberId, ycloudPhoneNumberId));

  console.warn(`[ycloud-webhook] Channel ${ycloudPhoneNumberId} updated: ${JSON.stringify(updates)}`);
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Verify HMAC-SHA256 signature from YCloud-Signature header
  const signatureHeader = request.headers.get('YCloud-Signature');
  const verification = verifyYCloudSignature(rawBody, signatureHeader);
  if (!verification.ok) {
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  let body: YCloudPayload;
  try {
    body = JSON.parse(rawBody) as YCloudPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const eventType = body.type;
  const eventId = body.id;

  if (!eventType || !eventId) {
    return NextResponse.json({ received: true });
  }

  // Idempotency: deduplicate by event ID
  const now = Date.now();
  cleanupSeenEvents(now);
  if (seenEvents.has(eventId)) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  seenEvents.set(eventId, now + DEDUP_TTL_MS);

  try {
    switch (eventType) {
      case 'whatsapp.inbound_message.received': {
        await handleInboundMessageReceived(body);
        break;
      }
      case 'whatsapp.message.updated': {
        await handleMessageUpdated(body);
        break;
      }
      case 'whatsapp.template.reviewed': {
        await handleTemplateReviewed(body);
        break;
      }
      case 'whatsapp.phone_number.updated': {
        await handlePhoneNumberUpdated(body);
        break;
      }
      default:
        console.warn(`[ycloud-webhook] Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    console.error(`[ycloud-webhook] DB error processing event ${eventType}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}