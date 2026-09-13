CREATE TABLE international_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  default_language VARCHAR(2) NOT NULL DEFAULT 'en',
  locale VARCHAR(16) NOT NULL DEFAULT 'fr-BE',
  timezone VARCHAR(100) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT international_settings_single_row CHECK (id = 1),
  CONSTRAINT international_settings_language_valid CHECK (default_language IN ('en', 'fr')),
  CONSTRAINT international_settings_locale_valid CHECK (locale IN ('en-GB', 'en-US', 'fr-BE', 'fr-FR')),
  CONSTRAINT international_settings_timezone_not_blank CHECK (BTRIM(timezone) <> '')
);

INSERT INTO international_settings (id, default_language, locale, timezone)
VALUES (
  1,
  CASE
    WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'en'
    ELSE 'fr'
  END,
  'fr-BE',
  COALESCE(NULLIF(current_setting('attendance_log.bootstrap_timezone', TRUE), ''), 'Europe/Brussels')
);

ALTER TABLE admin_users
  ADD COLUMN ui_language VARCHAR(2),
  ADD CONSTRAINT admin_users_ui_language_valid CHECK (ui_language IS NULL OR ui_language IN ('en', 'fr'));

ALTER TABLE classes
  ADD COLUMN language VARCHAR(2),
  ADD CONSTRAINT classes_language_valid CHECK (language IS NULL OR language IN ('en', 'fr'));

ALTER TABLE course_sessions
  ADD COLUMN language VARCHAR(2),
  ADD CONSTRAINT course_sessions_language_valid CHECK (language IS NULL OR language IN ('en', 'fr'));

ALTER TABLE students
  ADD COLUMN language VARCHAR(2),
  ADD CONSTRAINT students_language_valid CHECK (language IS NULL OR language IN ('en', 'fr'));
