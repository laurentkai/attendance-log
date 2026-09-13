ALTER TABLE application_terminology RENAME TO application_terminology_legacy;

CREATE TABLE application_terminology (
  language VARCHAR(2) PRIMARY KEY,
  student_singular TEXT NOT NULL,
  student_plural TEXT NOT NULL,
  class_singular TEXT NOT NULL,
  class_plural TEXT NOT NULL,
  session_singular TEXT NOT NULL,
  session_plural TEXT NOT NULL,
  attendance_singular TEXT NOT NULL,
  attendance_plural TEXT NOT NULL,
  instructor_singular TEXT NOT NULL,
  instructor_plural TEXT NOT NULL,
  membership_singular TEXT NOT NULL,
  membership_plural TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_terminology_language_valid CHECK (language IN ('en', 'fr')),
  CONSTRAINT application_terminology_values_valid CHECK (
    BTRIM(student_singular) <> '' AND CHAR_LENGTH(student_singular) <= 40
    AND BTRIM(student_plural) <> '' AND CHAR_LENGTH(student_plural) <= 40
    AND BTRIM(class_singular) <> '' AND CHAR_LENGTH(class_singular) <= 40
    AND BTRIM(class_plural) <> '' AND CHAR_LENGTH(class_plural) <= 40
    AND BTRIM(session_singular) <> '' AND CHAR_LENGTH(session_singular) <= 40
    AND BTRIM(session_plural) <> '' AND CHAR_LENGTH(session_plural) <= 40
    AND BTRIM(attendance_singular) <> '' AND CHAR_LENGTH(attendance_singular) <= 40
    AND BTRIM(attendance_plural) <> '' AND CHAR_LENGTH(attendance_plural) <= 40
    AND BTRIM(instructor_singular) <> '' AND CHAR_LENGTH(instructor_singular) <= 40
    AND BTRIM(instructor_plural) <> '' AND CHAR_LENGTH(instructor_plural) <= 40
    AND BTRIM(membership_singular) <> '' AND CHAR_LENGTH(membership_singular) <= 40
    AND BTRIM(membership_plural) <> '' AND CHAR_LENGTH(membership_plural) <= 40
  )
);

INSERT INTO application_terminology (
  language, student_singular, student_plural, class_singular, class_plural,
  session_singular, session_plural, attendance_singular, attendance_plural,
  instructor_singular, instructor_plural, membership_singular, membership_plural,
  updated_at
)
SELECT
  'fr',
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Participant' ELSE student_singular END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Participants' ELSE student_plural END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Activité' ELSE class_singular END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Activités' ELSE class_plural END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Session' ELSE session_singular END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Sessions' ELSE session_plural END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Présence' ELSE attendance_singular END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Présences' ELSE attendance_plural END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Responsable' ELSE instructor_singular END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Responsables' ELSE instructor_plural END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Inscription' ELSE membership_singular END,
  CASE WHEN current_setting('attendance_log.fresh_install', TRUE) = 'true' THEN 'Inscriptions' ELSE membership_plural END,
  updated_at
FROM application_terminology_legacy
WHERE id = 1;

INSERT INTO application_terminology (
  language, student_singular, student_plural, class_singular, class_plural,
  session_singular, session_plural, attendance_singular, attendance_plural,
  instructor_singular, instructor_plural, membership_singular, membership_plural
) VALUES (
  'en', 'Student', 'Students', 'Class', 'Classes', 'Session', 'Sessions',
  'Attendance', 'Attendance', 'Instructor', 'Instructors', 'Registration', 'Registrations'
);

DROP TABLE application_terminology_legacy;
