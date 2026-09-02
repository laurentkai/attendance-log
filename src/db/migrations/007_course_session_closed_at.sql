ALTER TABLE course_sessions
  ADD COLUMN closed_at TIMESTAMPTZ;

UPDATE course_sessions
SET closed_at = CURRENT_TIMESTAMP
WHERE state = 'closed';
