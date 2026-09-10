CREATE TABLE avery_print_designs (
  profile_reference VARCHAR(16) PRIMARY KEY,
  layout_data JSONB NOT NULL,
  updated_by_admin_user_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT avery_print_design_layout_object CHECK (jsonb_typeof(layout_data) = 'object'),
  CONSTRAINT avery_print_design_layout_size CHECK (octet_length(layout_data::text) <= 16384)
);
