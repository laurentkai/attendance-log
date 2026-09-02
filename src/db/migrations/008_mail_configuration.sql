CREATE TABLE mail_configuration (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  security_mode TEXT NOT NULL,
  smtp_username TEXT,
  smtp_password TEXT,
  sender_email TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  reply_to TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mail_configuration_single_row CHECK (id = 1),
  CONSTRAINT mail_configuration_port_valid CHECK (smtp_port BETWEEN 1 AND 65535),
  CONSTRAINT mail_configuration_security_valid
    CHECK (security_mode IN ('starttls', 'tls', 'none')),
  CONSTRAINT mail_configuration_auth_complete
    CHECK (
      (smtp_username IS NULL AND smtp_password IS NULL)
      OR (smtp_username IS NOT NULL AND smtp_password IS NOT NULL)
    )
);
