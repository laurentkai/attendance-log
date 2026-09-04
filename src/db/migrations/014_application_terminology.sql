CREATE TABLE application_terminology (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  student_singular TEXT NOT NULL DEFAULT 'Participant',
  student_plural TEXT NOT NULL DEFAULT 'Participants',
  class_singular TEXT NOT NULL DEFAULT 'Activité',
  class_plural TEXT NOT NULL DEFAULT 'Activités',
  session_singular TEXT NOT NULL DEFAULT 'Session',
  session_plural TEXT NOT NULL DEFAULT 'Sessions',
  attendance_singular TEXT NOT NULL DEFAULT 'Présence',
  attendance_plural TEXT NOT NULL DEFAULT 'Présences',
  instructor_singular TEXT NOT NULL DEFAULT 'Responsable',
  instructor_plural TEXT NOT NULL DEFAULT 'Responsables',
  membership_singular TEXT NOT NULL DEFAULT 'Inscription',
  membership_plural TEXT NOT NULL DEFAULT 'Inscriptions',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_terminology_single_row CHECK (id = 1),
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

INSERT INTO application_terminology (id) VALUES (1);
