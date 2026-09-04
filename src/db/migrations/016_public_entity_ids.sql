ALTER TABLE students
  ADD COLUMN public_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT students_public_id_unique UNIQUE (public_id);

ALTER TABLE classes
  ADD COLUMN public_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT classes_public_id_unique UNIQUE (public_id);

ALTER TABLE course_sessions
  ADD COLUMN public_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT course_sessions_public_id_unique UNIQUE (public_id);

ALTER TABLE admin_users
  ADD COLUMN public_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT admin_users_public_id_unique UNIQUE (public_id);
