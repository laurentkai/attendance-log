CREATE TABLE admin_break_glass_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX admin_break_glass_attempts_username_index
  ON admin_break_glass_attempts (username_hash, attempted_at DESC);

CREATE INDEX admin_break_glass_attempts_ip_index
  ON admin_break_glass_attempts (ip_hash, attempted_at DESC);
