CREATE TABLE students (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  student_code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT students_student_code_format
    CHECK (student_code ~ '^[A-HJ-NP-Z2-9]{7}$')
);

CREATE UNIQUE INDEX students_email_case_insensitive_unique
  ON students (LOWER(email));

CREATE TABLE classes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE student_classes (
  student_id BIGINT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  class_id BIGINT NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, class_id)
);

CREATE TABLE course_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id BIGINT NOT NULL REFERENCES classes (id),
  date DATE NOT NULL,
  title TEXT NOT NULL,
  instructor TEXT NOT NULL,
  notes TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  CONSTRAINT course_sessions_state_valid CHECK (state IN ('open', 'closed'))
);

CREATE INDEX student_classes_class_id_index ON student_classes (class_id);
CREATE INDEX course_sessions_class_id_index ON course_sessions (class_id);
