ALTER TABLE attendance_records
  ADD COLUMN checked_in_at TIMESTAMPTZ;

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_checked_in_status_valid
  CHECK (status = 'present' OR checked_in_at IS NULL);

ALTER TABLE classes
  ADD COLUMN punctuality_tolerance_minutes SMALLINT NOT NULL DEFAULT 5,
  ADD CONSTRAINT classes_punctuality_tolerance_valid
  CHECK (punctuality_tolerance_minutes IN (5, 10, 15));

ALTER TABLE course_sessions
  ADD COLUMN start_time TIME WITHOUT TIME ZONE,
  ADD COLUMN punctuality_tolerance_override_minutes SMALLINT,
  ADD CONSTRAINT course_sessions_punctuality_tolerance_valid
  CHECK (punctuality_tolerance_override_minutes IS NULL
    OR punctuality_tolerance_override_minutes IN (5, 10, 15));
