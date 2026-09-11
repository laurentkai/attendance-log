ALTER TABLE students
  ADD COLUMN created_at TIMESTAMPTZ,
  ADD COLUMN last_activity_at TIMESTAMPTZ;

UPDATE students s
SET created_at = COALESCE(
  (
    SELECT MIN(ar.updated_at)
    FROM attendance_records ar
    WHERE ar.student_id = s.id
  ),
  CURRENT_TIMESTAMP
);

UPDATE students s
SET last_activity_at = (
  SELECT MAX(ar.updated_at)
  FROM attendance_records ar
  WHERE ar.student_id = s.id
    AND ar.status IN ('present', 'absent')
);

ALTER TABLE students
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE student_classes
  ADD COLUMN created_at TIMESTAMPTZ;

UPDATE student_classes sc
SET created_at = COALESCE(
  (
    SELECT MIN(ar.updated_at)
    FROM attendance_records ar
    INNER JOIN course_sessions cs ON cs.id = ar.session_id
    WHERE ar.student_id = sc.student_id
      AND cs.class_id = sc.class_id
  ),
  CURRENT_TIMESTAMP
);

ALTER TABLE student_classes
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN created_at SET NOT NULL;

CREATE TABLE data_retention_configuration (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  inactive_student_retention_months SMALLINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_retention_configuration_single_row CHECK (id = 1),
  CONSTRAINT data_retention_configuration_months_valid CHECK (
    inactive_student_retention_months IS NULL
    OR inactive_student_retention_months IN (12, 24, 36, 60)
  )
);

INSERT INTO data_retention_configuration (id) VALUES (1);

CREATE INDEX students_retention_preview_index
  ON students (active, last_activity_at, created_at);
