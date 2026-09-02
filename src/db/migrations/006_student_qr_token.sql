ALTER TABLE students
  ADD COLUMN qr_token UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE students
  ADD CONSTRAINT students_qr_token_unique UNIQUE (qr_token);
