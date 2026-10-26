-- 0054_rate_limit_windows.sql
-- Shared rate limit windows across serverless instances
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_expires_at ON rate_limit_windows (expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_key ON rate_limit_windows (key);
CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_window_start ON rate_limit_windows (window_start);

COMMENT ON TABLE rate_limit_windows IS 'Sliding window rate limit counters shared across instances';
COMMENT ON COLUMN rate_limit_windows.key IS 'Identifier:ip:windowMs';
COMMENT ON COLUMN rate_limit_windows.window_start IS 'Start of the sliding window';
COMMENT ON COLUMN rate_limit_windows.count IS 'Request count in window';
COMMENT ON COLUMN rate_limit_windows.expires_at IS 'Expiration for cleanup';
