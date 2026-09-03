CREATE TABLE restore_history (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  filename TEXT NOT NULL,
  backup_generated_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  fingerprint_match BOOLEAN,
  error_summary TEXT,
  CONSTRAINT restore_history_source_valid CHECK (source IN ('local', 's3', 'azure')),
  CONSTRAINT restore_history_status_valid CHECK (status IN ('success', 'failed'))
);

CREATE INDEX restore_history_started_at_idx ON restore_history (started_at DESC);
