CREATE TABLE admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_admin_user_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_name VARCHAR(120),
  actor_role VARCHAR(32),
  action VARCHAR(80) NOT NULL,
  category VARCHAR(40) NOT NULL,
  target_type VARCHAR(40),
  target_public_id UUID,
  target_label VARCHAR(240),
  result VARCHAR(16) NOT NULL CHECK (result IN ('success', 'denied', 'failed')),
  summary VARCHAR(500) NOT NULL,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB,
  ip_hash VARCHAR(64),
  user_agent_hash VARCHAR(64),
  CONSTRAINT admin_audit_before_object CHECK (before_data IS NULL OR jsonb_typeof(before_data) = 'object'),
  CONSTRAINT admin_audit_after_object CHECK (after_data IS NULL OR jsonb_typeof(after_data) = 'object'),
  CONSTRAINT admin_audit_metadata_object CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object')
);

CREATE INDEX admin_audit_log_occurred_at_idx ON admin_audit_log (occurred_at DESC, id DESC);
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log (actor_admin_user_id, occurred_at DESC);
CREATE INDEX admin_audit_log_category_action_idx ON admin_audit_log (category, action, occurred_at DESC);
CREATE INDEX admin_audit_log_result_idx ON admin_audit_log (result, occurred_at DESC);
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log (target_type, target_public_id, occurred_at DESC);
