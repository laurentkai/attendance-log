ALTER TABLE admin_users
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN account_type TEXT NOT NULL DEFAULT 'otp',
  ADD COLUMN username TEXT,
  ADD COLUMN session_version BIGINT NOT NULL DEFAULT 1;

UPDATE admin_users
SET password_hash = NULL,
    account_type = 'otp',
    username = NULL;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_account_type_valid
    CHECK (account_type IN ('otp', 'break_glass')),
  ADD CONSTRAINT admin_users_account_shape_valid
    CHECK (
      (account_type = 'otp'
        AND email IS NOT NULL
        AND BTRIM(email) <> ''
        AND username IS NULL
        AND password_hash IS NULL)
      OR
      (account_type = 'break_glass'
        AND email IS NULL
        AND username IS NOT NULL
        AND BTRIM(username) <> ''
        AND password_hash IS NOT NULL
        AND role = 'administrator'
        AND active = TRUE)
    ),
  ADD CONSTRAINT admin_users_session_version_positive
    CHECK (session_version >= 1);

CREATE UNIQUE INDEX admin_users_username_case_insensitive_unique
  ON admin_users (LOWER(username))
  WHERE username IS NOT NULL;

CREATE UNIQUE INDEX admin_users_single_break_glass
  ON admin_users (account_type)
  WHERE account_type = 'break_glass';

CREATE TABLE admin_otp_challenges (
  id UUID PRIMARY KEY,
  user_id BIGINT REFERENCES admin_users(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  otp_hash TEXT,
  attempts SMALLINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  CONSTRAINT admin_otp_attempts_valid CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX admin_otp_challenges_email_rate_index
  ON admin_otp_challenges (email_hash, created_at DESC);

CREATE INDEX admin_otp_challenges_ip_rate_index
  ON admin_otp_challenges (ip_hash, created_at DESC);
