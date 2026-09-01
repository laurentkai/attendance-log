CREATE TABLE attendance_records (
  session_id BIGINT NOT NULL REFERENCES course_sessions (id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES students (id),
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, student_id),
  CONSTRAINT attendance_records_status_valid
    CHECK (status IN ('pending', 'present', 'absent'))
);

CREATE INDEX attendance_records_student_id_index
  ON attendance_records (student_id);
