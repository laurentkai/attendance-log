CREATE TABLE application_branding (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  logo_data BYTEA,
  logo_mime_type TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_branding_logo_consistency CHECK (
    (logo_data IS NULL AND logo_mime_type IS NULL)
    OR (logo_data IS NOT NULL AND logo_mime_type = 'image/png')
  )
);

INSERT INTO application_branding (id) VALUES (1);

ALTER TABLE classes
  ADD COLUMN logo_data BYTEA,
  ADD COLUMN logo_mime_type TEXT,
  ADD COLUMN logo_updated_at TIMESTAMPTZ,
  ADD CONSTRAINT classes_logo_consistency CHECK (
    (logo_data IS NULL AND logo_mime_type IS NULL AND logo_updated_at IS NULL)
    OR (logo_data IS NOT NULL AND logo_mime_type = 'image/png' AND logo_updated_at IS NOT NULL)
  );
