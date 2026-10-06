export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  // Only available server-side — never expose to the client
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  // Feature flags
  // Order Flow V2 — nuevo ciclo de vida de 12 estados con state machine, timeline, attachments
  orderFlowV2: process.env.ORDER_FLOW_V2 === 'true',
  // Habilita el rewrite de subdominios en proxy.ts (Fase 2 de la migración a subdominios)
  featureSubdomainRewrite: process.env.FEATURE_SUBDOMAIN_REWRITE === 'true',
  // Dominio compartido para cookies cross-subdominio (Fase 4).
  //   Producción: `.store-lite.com`
  //   Desarrollo: `.localhost`
  //   null/empty → cookies host-only (comportamiento default, no cross-subdominio)
  sharedCookieDomain: process.env.SHARED_COOKIE_DOMAIN || null,
  // JSON.pe API Configuration (Server-side only) — consulta RUC, DNI, representantes
  jsonToken: process.env.JSON_TOKEN!,
  jsonpeApiBaseUrl: process.env.JSONPE_API_BASE_URL || 'https://api.json.pe/api',
  jsonWspInstance: process.env.JSON_WSP_INSTANCE!,
  // Twilio WhatsApp OTP Configuration (Server-side only)
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID!,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN!,
  twilioWhatsAppNumber: process.env.TWILIO_WHATSAPP_NUMBER!,
  // Twilio Verify Service SID for OTP verification (WhatsApp)
  twilioServiceSid: process.env.TWILIO_SERVICE_SID!,
  // JSON.pe SMS — order notifications to customers
  jsonpeSmsToken: process.env.JSONPE_SMS_TOKEN!,
  // Culqi — al activar esta flag, solo se aceptan llaves _live (producción).
  //   false/omit → acepta cualquier key pk_/sk_ (desarrollo).
  //   true       → fuerza pk_live_ / sk_live_ al guardar credenciales.
  enforceLiveCulqiKeys: process.env.CULQI_ENFORCE_LIVE_KEYS === 'true',
  // Culqi webhook authentication (CulqiPanel uses basic auth)
  culqiWebhookUser: process.env.CULQI_WEBHOOK_USER || '',
  culqiWebhookPass: process.env.CULQI_WEBHOOK_PASS || '',
  // Resend — transactional emails (Server-side only)
  resendApiKey: process.env.RESEND_API_KEY!,
  resendFromEmail: process.env.RESEND_FROM_EMAIL!,
  // OTP Hashing (Server-side only)
  // Usado como HMAC secret para hashear OTPs antes de almacenarlos en DB.
  // En producción, debe ser un string aleatorio fuerte. Si no se configura,
  // se usa un fallback para dev — pero OJO, no es seguro para producción.
  otpHashSecret: process.env.OTP_HASH_SECRET || 'dev-fallback-otp-secret-not-for-production',
  // CRON_SECRET / cron_secret — protege los endpoints cron contra acceso público.
  //   Las llamadas desde Supabase pg_cron deben incluir este token.
  cronSecret: process.env.CRON_SECRET || process.env.cron_secret || '',
  // Meta Pixel + Conversions API (CAPI) — tracking consent-gated (ver sl_consent_status).
  //   NEXT_PUBLIC_META_PIXEL_ID: público, usado por el pixel en el navegador.
  //   META_CAPI_ACCESS_TOKEN: solo server-side, NUNCA exponer al cliente.
  //   META_TEST_EVENT_CODE: opcional, para validar eventos en Meta Events Manager.
  //   Todos con fallback vacío: sin config, warnings y no-op (el app nunca crashea).
  metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID || '',
  metaCapiAccessToken: process.env.META_CAPI_ACCESS_TOKEN || '',
  metaTestEventCode: process.env.META_TEST_EVENT_CODE || '',

  // YCloud WhatsApp Embedded Signup (Server-side only)
  //   YCLOUD_API_KEY: Tech Partner API key
  //   YCLOUD_WABA_ID: Store Lite's WABA ID in YCloud
  //   YCLOUD_WEBHOOK_SECRET: Webhook signature verification secret
  ycloudApiKey: process.env.YCLOUD_API_KEY || '',
  ycloudWabaId: process.env.YCLOUD_WABA_ID || '',
  ycloudWebhookSecret: process.env.YCLOUD_WEBHOOK_SECRET || '',
  // YCloud Meta partner config for Facebook Embedded Signup (public — the
  // coexistence popup needs these client-side). warn-if-missing: unset → the
  // UI keeps the pair-code modal as fallback.
  ycloudFbAppId: process.env.NEXT_PUBLIC_YCLOUD_FB_APP_ID || '',
  ycloudFbConfigId: process.env.NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID || '',
  ycloudFbSolutionId: process.env.NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID || '',
  // WhatsApp anti-spam rate limiting (per channel/seller) — protects the Meta
  // quality rating. Kept as STRINGS on purpose; parsing lives in the send
  // guards (src/core/whatsapp/guards/whatsappSendGuards.ts). Defaults are safe.
  whatsappRateLimitPerWindow: process.env.WHATSAPP_RATE_LIMIT_PER_WINDOW || '100',
  whatsappRateLimitWindowMinutes: process.env.WHATSAPP_RATE_LIMIT_WINDOW_MINUTES || '5',
} as const;

// Optional: Add validation here to throw early if vars are missing
if (!env.supabaseUrl || !env.supabaseAnonKey) {
  console.warn('Supabase environment variables are missing. Some features may not work.');
}

// Twilio validation
if (!env.twilioAccountSid || !env.twilioAuthToken || !env.twilioWhatsAppNumber) {
  console.warn('Twilio environment variables are missing. WhatsApp OTP will not work.');
}
if (!env.twilioServiceSid) {
  console.warn('TWILIO_SERVICE_SID is missing. OTP verification via Twilio Verify will not work.');
}

// Resend validation
if (!env.resendApiKey || !env.resendFromEmail) {
  console.warn('Resend environment variables are missing. Email notifications will not work.');
}

// OTP hash secret: warn if using dev fallback
if (!process.env.OTP_HASH_SECRET) {
  console.warn(
    '[OTP] OTP_HASH_SECRET not set. Using DEV FALLBACK — DO NOT USE IN PRODUCTION. ' +
      'Set a strong random string in production.',
  );
}

// Meta Pixel / CAPI validation — warn-if-missing, never crash.
// El pixel funciona sin token CAPI; CAPI no envía nada sin token.
if (!env.metaPixelId) {
  console.warn('NEXT_PUBLIC_META_PIXEL_ID is missing. Meta Pixel tracking will not load.');
}
if (!env.metaCapiAccessToken) {
  console.warn('META_CAPI_ACCESS_TOKEN is missing. Meta CAPI events will not be sent.');
}

// YCloud WhatsApp validation
if (!env.ycloudApiKey || !env.ycloudWabaId) {
  console.warn(
    'YCloud environment variables (YCLOUD_API_KEY, YCLOUD_WABA_ID) are missing. WhatsApp Embedded Signup will not work.',
  );
}
if (!env.ycloudWebhookSecret) {
  console.warn(
    'YCLOUD_WEBHOOK_SECRET is missing. Webhook signature verification will be skipped in development.',
  );
}

// YCloud Facebook Embedded Signup — public Meta partner config. Missing → the
// coexistence popup is disabled and the pair-code modal stays as fallback.
if (!env.ycloudFbAppId || !env.ycloudFbConfigId || !env.ycloudFbSolutionId) {
  console.warn(
    'NEXT_PUBLIC_YCLOUD_FB_APP_ID, NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID and NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID are missing. WhatsApp coexistence popup will not load; the pair-code modal stays as fallback.',
  );
}
