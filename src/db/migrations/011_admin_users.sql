CREATE TABLE admin_users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMPTZ,
  CONSTRAINT admin_users_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT admin_users_email_not_blank CHECK (BTRIM(email) <> ''),
  CONSTRAINT admin_users_role_valid
    CHECK (role IN ('administrator', 'manager', 'attendance_operator'))
);

CREATE UNIQUE INDEX admin_users_email_case_insensitive_unique
  ON admin_users (LOWER(email));
