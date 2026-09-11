ALTER TABLE admin_users
  ADD COLUMN view_pii BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE reporting_privacy_configuration (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  pseudonym_secret_ciphertext TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reporting_privacy_configuration_single_row CHECK (id = 1)
);

INSERT INTO reporting_privacy_configuration (id) VALUES (1);
