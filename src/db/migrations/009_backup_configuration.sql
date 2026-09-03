CREATE TABLE backup_configuration (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT,
  frequency TEXT NOT NULL DEFAULT 'daily',
  execution_time TIME NOT NULL DEFAULT '02:00',
  weekday SMALLINT,
  retention_days INTEGER NOT NULL DEFAULT 30,
  next_run_at TIMESTAMPTZ,
  s3_bucket TEXT,
  s3_region TEXT,
  s3_endpoint TEXT,
  s3_prefix TEXT,
  s3_access_key_id TEXT,
  s3_secret_access_key TEXT,
  s3_force_path_style BOOLEAN NOT NULL DEFAULT FALSE,
  azure_account_name TEXT,
  azure_container_name TEXT,
  azure_account_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT backup_configuration_single_row CHECK (id = 1),
  CONSTRAINT backup_configuration_provider_valid CHECK (provider IS NULL OR provider IN ('s3', 'azure')),
  CONSTRAINT backup_configuration_frequency_valid CHECK (frequency IN ('daily', 'weekly')),
  CONSTRAINT backup_configuration_weekday_valid CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  CONSTRAINT backup_configuration_retention_valid CHECK (retention_days BETWEEN 1 AND 3650),
  CONSTRAINT backup_configuration_schedule_valid CHECK (
    (frequency = 'daily' AND weekday IS NULL)
    OR (frequency = 'weekly' AND weekday IS NOT NULL)
  )
);

INSERT INTO backup_configuration (id) VALUES (1);

CREATE TABLE backup_history (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  run_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT,
  size_bytes BIGINT,
  status TEXT NOT NULL,
  error_summary TEXT,
  CONSTRAINT backup_history_run_type_valid CHECK (run_type IN ('manual_download', 'manual_cloud', 'scheduled')),
  CONSTRAINT backup_history_provider_valid CHECK (provider IN ('local', 's3', 'azure')),
  CONSTRAINT backup_history_status_valid CHECK (status IN ('success', 'failed')),
  CONSTRAINT backup_history_size_valid CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE INDEX backup_history_started_at_idx ON backup_history (started_at DESC);
