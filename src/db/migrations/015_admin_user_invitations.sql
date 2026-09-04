ALTER TABLE admin_users
  ADD COLUMN invitation_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN invitation_sent_at TIMESTAMPTZ;
