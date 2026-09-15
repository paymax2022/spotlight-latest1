-- Create promotions_banners table for managing promotional content
CREATE TABLE promotions_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  image_url text NOT NULL, -- Cloudflare R2 presigned URL
  action_link text,
  action_label text,
  module text NOT NULL, -- health, restaurant, mobility, etc.
  priority int NOT NULL DEFAULT 0, -- Higher = shown first
  start_date timestamptz NOT NULL DEFAULT now(),
  end_date timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying active banners by module
CREATE INDEX idx_promotions_banners_module_active
  ON promotions_banners(module, is_active, start_date, end_date)
  WHERE is_active = true;

-- Index for ordering by priority
CREATE INDEX idx_promotions_banners_priority
  ON promotions_banners(module, priority DESC, created_at DESC);

-- Enable RLS (read-only for all, write for admins only)
ALTER TABLE promotions_banners ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read active banners
CREATE POLICY "Anyone can read active banners"
  ON promotions_banners
  FOR SELECT
  USING (true);

-- Only admins can insert/update/delete (enforced at app level)
CREATE POLICY "Only admins can manage banners"
  ON promotions_banners
  FOR INSERT
  WITH CHECK (false); -- Enforced via app-level RBAC

CREATE POLICY "Only admins can update banners"
  ON promotions_banners
  FOR UPDATE
  USING (false);

CREATE POLICY "Only admins can delete banners"
  ON promotions_banners
  FOR DELETE
  USING (false);

COMMENT ON TABLE promotions_banners IS 'Promotional banners and hero images managed by admins, served to users by module';
COMMENT ON COLUMN promotions_banners.image_url IS 'Presigned Cloudflare R2 URL (expires based on R2 config)';
COMMENT ON COLUMN promotions_banners.module IS 'Target module: health, restaurant, mobility, marketplace, etc.';
COMMENT ON COLUMN promotions_banners.priority IS 'Display order within module (higher shown first)';
