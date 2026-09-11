ALTER TABLE students
  ADD COLUMN anonymized_at TIMESTAMPTZ;

ALTER TABLE students
  ADD CONSTRAINT students_anonymized_inactive
  CHECK (anonymized_at IS NULL OR active = FALSE);

CREATE INDEX students_anonymized_at_index
  ON students (anonymized_at)
  WHERE anonymized_at IS NOT NULL;
