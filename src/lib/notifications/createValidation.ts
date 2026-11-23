import {
  notificationCategoryEnum,
  notificationTypeEnum,
  type NotificationCategory,
  type NotificationType,
} from '@/core/database/schema';

export interface ValidatedNotificationCreate {
  businessId: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  data: Record<string, unknown>;
}

export type NotificationCreateValidation =
  | { ok: true; value: ValidatedNotificationCreate }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_FIELDS = new Set(['businessId', 'type', 'category', 'title', 'message', 'data']);
const BLOCKED_DATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 500;
const MAX_DATA_BYTES = 4096;
const MAX_DATA_DEPTH = 3;
const MAX_DATA_NODES = 100;
const MAX_DATA_KEYS = 40;
const MAX_DATA_ARRAY_LENGTH = 50;
const MAX_DATA_STRING_LENGTH = 500;
const MAX_DATA_KEY_LENGTH = 64;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

interface DataBudget {
  nodes: number;
}

function isAllowedDataValue(value: unknown, depth: number, budget: DataBudget): boolean {
  if (depth > MAX_DATA_DEPTH) return false;

  budget.nodes += 1;
  if (budget.nodes > MAX_DATA_NODES) return false;

  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_DATA_STRING_LENGTH;

  if (Array.isArray(value)) {
    if (value.length > MAX_DATA_ARRAY_LENGTH) return false;
    return value.every((item) => isAllowedDataValue(item, depth + 1, budget));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_DATA_KEYS) return false;
    return entries.every(
      ([key, item]) =>
        key.length <= MAX_DATA_KEY_LENGTH &&
        !BLOCKED_DATA_KEYS.has(key) &&
        isAllowedDataValue(item, depth + 1, budget),
    );
  }

  return false;
}

function validateData(value: unknown): value is Record<string, unknown> {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;

  const budget: DataBudget = { nodes: 0 };
  if (!isAllowedDataValue(value, 0, budget)) return false;

  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_DATA_BYTES;
  } catch {
    return false;
  }
}

export function validateNotificationCreateBody(body: unknown): NotificationCreateValidation {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Cuerpo inválido' };
  }

  const unexpectedFields = Object.keys(body).filter((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedFields.length > 0) {
    return { ok: false, error: 'Campos inesperados' };
  }

  const { businessId, type, category, title, message, data } = body;

  if (!isValidUuid(businessId)) {
    return { ok: false, error: 'businessId inválido' };
  }

  if (!notificationTypeEnum.enumValues.includes(type as NotificationType)) {
    return { ok: false, error: 'Tipo inválido' };
  }

  if (!notificationCategoryEnum.enumValues.includes(category as NotificationCategory)) {
    return { ok: false, error: 'Categoría inválida' };
  }

  if (typeof title !== 'string' || typeof message !== 'string') {
    return { ok: false, error: 'Título o mensaje inválidos' };
  }

  const normalizedTitle = title.trim();
  const normalizedMessage = message.trim();
  if (
    normalizedTitle.length === 0 ||
    normalizedTitle.length > MAX_TITLE_LENGTH ||
    normalizedMessage.length === 0 ||
    normalizedMessage.length > MAX_MESSAGE_LENGTH
  ) {
    return { ok: false, error: 'Título o mensaje inválidos' };
  }

  if (!validateData(data)) {
    return { ok: false, error: 'Datos inválidos' };
  }

  return {
    ok: true,
    value: {
      businessId,
      type: type as NotificationType,
      category: category as NotificationCategory,
      title: normalizedTitle,
      message: normalizedMessage,
      data: data ?? {},
    },
  };
}
