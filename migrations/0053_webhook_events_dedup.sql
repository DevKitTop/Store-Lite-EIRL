-- 0053_webhook_events_dedup.sql
-- Shared webhook event deduplication across serverless instances
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_expires_at ON webhook_events (expires_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events (processed_at);

COMMENT ON TABLE webhook_events IS 'Idempotency store for webhook events processed across instances';
COMMENT ON COLUMN webhook_events.event_id IS 'Culqi event id or composite key (eventType:chargeId)';
COMMENT ON COLUMN webhook_events.expires_at IS 'Expiration for cleanup';
