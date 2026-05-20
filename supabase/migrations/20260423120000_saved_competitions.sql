-- Saved Competitions for Non-Admin Users
-- Allows users to bookmark competitions they're interested in

CREATE TABLE IF NOT EXISTS saved_competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  competition_id uuid REFERENCES contests(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, competition_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_saved_competitions_user_id ON saved_competitions(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_competitions_competition_id ON saved_competitions(competition_id);
CREATE INDEX IF NOT EXISTS idx_saved_competitions_created_at ON saved_competitions(created_at DESC);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_saved_competitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_saved_competitions_timestamp
  BEFORE UPDATE ON saved_competitions
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_competitions_updated_at();

-- Row Level Security
ALTER TABLE saved_competitions ENABLE ROW LEVEL SECURITY;

-- Users can view their own saved competitions
CREATE POLICY "Users can view own saved competitions"
  ON saved_competitions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can save competitions
CREATE POLICY "Users can save competitions"
  ON saved_competitions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can remove their saved competitions
CREATE POLICY "Users can remove own saved competitions"
  ON saved_competitions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can view all saved competitions
CREATE POLICY "Admins can view all saved competitions"
  ON saved_competitions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND LOWER(user_profiles.role) = 'admin'
    )
  );

-- Comment
COMMENT ON TABLE saved_competitions IS 'User-saved/bookmarked competitions for quick access';
