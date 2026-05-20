-- ============================================================
-- One-Beat, One-Verse Winners and Fulfillment
-- ============================================================

CREATE TABLE IF NOT EXISTS public.winner_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  winner_tier TEXT NOT NULL DEFAULT 'winner',
  award_title TEXT NOT NULL DEFAULT '',
  announcement_note TEXT NOT NULL DEFAULT '',
  announced_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  announced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_winner_records_competition_tier_unique
  ON public.winner_records(competition_id, winner_tier);

CREATE INDEX IF NOT EXISTS idx_winner_records_competition_created
  ON public.winner_records(competition_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_winner_records_entry
  ON public.winner_records(entry_id);

CREATE TABLE IF NOT EXISTS public.prize_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_record_id UUID NOT NULL REFERENCES public.winner_records(id) ON DELETE CASCADE,
  prize_type TEXT NOT NULL DEFAULT 'cash',
  prize_value TEXT NOT NULL DEFAULT '',
  fulfillment_status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_note TEXT NOT NULL DEFAULT '',
  fulfilled_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prize_fulfillments_winner
  ON public.prize_fulfillments(winner_record_id);

CREATE INDEX IF NOT EXISTS idx_prize_fulfillments_status
  ON public.prize_fulfillments(fulfillment_status);

CREATE OR REPLACE FUNCTION public.update_winner_records_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_prize_fulfillments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_winner_records_updated_at ON public.winner_records;
CREATE TRIGGER set_winner_records_updated_at
  BEFORE UPDATE ON public.winner_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_winner_records_updated_at();

DROP TRIGGER IF EXISTS set_prize_fulfillments_updated_at ON public.prize_fulfillments;
CREATE TRIGGER set_prize_fulfillments_updated_at
  BEFORE UPDATE ON public.prize_fulfillments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_prize_fulfillments_updated_at();

ALTER TABLE public.winner_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prize_fulfillments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_published_winner_records" ON public.winner_records;
CREATE POLICY "public_read_published_winner_records"
ON public.winner_records FOR SELECT TO public
USING (published = true);

DROP POLICY IF EXISTS "admin_manage_winner_records" ON public.winner_records;
CREATE POLICY "admin_manage_winner_records"
ON public.winner_records FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_read_prize_fulfillments" ON public.prize_fulfillments;
CREATE POLICY "admin_read_prize_fulfillments"
ON public.prize_fulfillments FOR SELECT TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_prize_fulfillments" ON public.prize_fulfillments;
CREATE POLICY "admin_manage_prize_fulfillments"
ON public.prize_fulfillments FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
