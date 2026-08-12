-- Admin voting system tables
-- Tracks all votes cast by admins for contestants

-- Admin votes table
CREATE TABLE IF NOT EXISTS admin_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0,
  admin_id TEXT,
  admin_name TEXT,
  competition_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(contestant_id, admin_id)
);

-- Vote audit log (tracks each vote action)
CREATE TABLE IF NOT EXISTS vote_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id TEXT NOT NULL,
  vote_amount INTEGER NOT NULL,
  admin_id TEXT,
  admin_name TEXT,
  action TEXT DEFAULT 'vote_added',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contestant voting stats (materialized summary)
CREATE TABLE IF NOT EXISTS contestant_vote_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id TEXT NOT NULL UNIQUE,
  contestant_name TEXT,
  competition_id TEXT,
  free_votes INTEGER DEFAULT 0,
  paid_votes INTEGER DEFAULT 0,
  admin_votes INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0,
  rank INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (Row Level Security)
ALTER TABLE admin_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE contestant_vote_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies for public read (admin voting is visible to admins)
CREATE POLICY "Admin votes readable by all" ON admin_votes FOR SELECT USING (true);
CREATE POLICY "Admin votes insertable by admins" ON admin_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin votes updatable by admins" ON admin_votes FOR UPDATE USING (true);

CREATE POLICY "Vote audit log readable by all" ON vote_audit_log FOR SELECT USING (true);
CREATE POLICY "Vote audit log insertable by admins" ON vote_audit_log FOR INSERT WITH CHECK (true);

CREATE POLICY "Contestant vote stats readable by all" ON contestant_vote_stats FOR SELECT USING (true);
CREATE POLICY "Contestant vote stats updatable by admins" ON contestant_vote_stats FOR UPDATE USING (true);

-- Create indexes for performance
CREATE INDEX idx_admin_votes_contestant ON admin_votes(contestant_id);
CREATE INDEX idx_admin_votes_admin ON admin_votes(admin_id);
CREATE INDEX idx_vote_audit_contestant ON vote_audit_log(contestant_id);
CREATE INDEX idx_contestant_vote_stats ON contestant_vote_stats(contestant_id);

-- Trigger to update vote_stats when admin_votes changes
CREATE OR REPLACE FUNCTION update_contestant_vote_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contestant_vote_stats (contestant_id, admin_votes, total_votes)
  VALUES (NEW.contestant_id, NEW.vote_count, NEW.vote_count)
  ON CONFLICT (contestant_id) DO UPDATE SET
    admin_votes = admin_votes + COALESCE(NEW.vote_count - COALESCE(OLD.vote_count, 0), 0),
    total_votes = contestant_vote_stats.free_votes + contestant_vote_stats.paid_votes + (admin_votes + COALESCE(NEW.vote_count - COALESCE(OLD.vote_count, 0), 0)),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_contestant_vote_stats
AFTER INSERT OR UPDATE ON admin_votes
FOR EACH ROW
EXECUTE FUNCTION update_contestant_vote_stats();
