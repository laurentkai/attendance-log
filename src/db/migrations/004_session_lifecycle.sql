ALTER TABLE course_sessions
  DROP CONSTRAINT course_sessions_state_valid;

ALTER TABLE course_sessions
  ADD COLUMN started_at TIMESTAMPTZ;

UPDATE course_sessions
SET started_at = CURRENT_TIMESTAMP
WHERE state IN ('open', 'closed');

ALTER TABLE course_sessions
  ALTER COLUMN state SET DEFAULT 'scheduled';

ALTER TABLE course_sessions
  ADD CONSTRAINT course_sessions_state_valid
  CHECK (state IN ('scheduled', 'open', 'closed'));
