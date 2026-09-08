ALTER TABLE classes
  ADD COLUMN summary_attach_xlsx BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE course_sessions
  ADD COLUMN summary_attach_xlsx_override BOOLEAN;

CREATE TABLE class_summary_admin_recipients (
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, admin_user_id)
);

CREATE TABLE class_summary_external_recipients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  email VARCHAR(254) NOT NULL,
  CONSTRAINT class_summary_external_email_not_blank CHECK (BTRIM(email) <> '')
);

CREATE UNIQUE INDEX class_summary_external_email_unique
  ON class_summary_external_recipients (class_id, LOWER(email));

CREATE TABLE session_summary_admin_recipients (
  session_id BIGINT NOT NULL REFERENCES course_sessions(id) ON DELETE CASCADE,
  admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, admin_user_id)
);

CREATE TABLE session_summary_external_recipients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES course_sessions(id) ON DELETE CASCADE,
  email VARCHAR(254) NOT NULL,
  CONSTRAINT session_summary_external_email_not_blank CHECK (BTRIM(email) <> '')
);

CREATE UNIQUE INDEX session_summary_external_email_unique
  ON session_summary_external_recipients (session_id, LOWER(email));

CREATE INDEX class_summary_admin_recipient_user_index
  ON class_summary_admin_recipients (admin_user_id);

CREATE INDEX session_summary_admin_recipient_user_index
  ON session_summary_admin_recipients (admin_user_id);
