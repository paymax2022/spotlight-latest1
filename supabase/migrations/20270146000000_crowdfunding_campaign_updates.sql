-- Campaign updates: the creator's posts to their backers.
--
-- Same gap the comments migration closed one table over. The post-update screen,
-- the updates timeline, and the "Updates" block on the campaign detail have all
-- existed for some time; GetDetail returned `"updates": []any{}` — a literal empty
-- array — so the timeline was permanently empty and a published update vanished
-- the moment the success screen was dismissed.
--
-- Shape follows the client's CampaignUpdate: id, title, body, imageUrl, createdAt,
-- likeCount. Only the author differs from what the client sees — it is recorded
-- but not returned, because the timeline shows the campaign's own voice and the
-- creator's name is already on the page.

CREATE TABLE IF NOT EXISTS public.cf_campaign_updates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    -- Who published it. Only the campaign's creator can, which the service
    -- enforces; storing it keeps the audit trail if a campaign changes hands.
    author_id   uuid NOT NULL,
    title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 140),
    body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
    -- The client sends an image URI it has already uploaded; NULL is the norm.
    image_url   text,
    deleted_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The timeline read: newest first within a campaign. id breaks created_at ties so
-- two updates published in the same millisecond cannot swap places between pages.
CREATE INDEX IF NOT EXISTS cf_campaign_updates_feed_idx
    ON public.cf_campaign_updates (campaign_id, created_at DESC, id DESC)
 WHERE deleted_at IS NULL;

-- likeCount is a COUNT over this table rather than a counter column on the update.
-- A counter drifts the moment anything writes it twice or a like is withdrawn; a
-- row per person cannot, and it is what makes liking idempotent.
CREATE TABLE IF NOT EXISTS public.cf_update_likes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    update_id  uuid NOT NULL REFERENCES public.cf_campaign_updates(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cf_update_likes_once_idx
    ON public.cf_update_likes (update_id, user_id);

ALTER TABLE public.cf_campaign_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_update_likes     ENABLE ROW LEVEL SECURITY;

-- Mirrors cf_campaign_comments: the Go backend holds the service role and does its
-- own authorization; a direct PostgREST caller reads what is public and writes
-- only its own rows. Reading is open because a campaign page shows its updates to
-- anyone, backer or not.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_updates' AND policyname='cf_campaign_updates_service') THEN
    CREATE POLICY cf_campaign_updates_service ON public.cf_campaign_updates FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_updates' AND policyname='cf_campaign_updates_read') THEN
    CREATE POLICY cf_campaign_updates_read ON public.cf_campaign_updates FOR SELECT TO authenticated, anon USING (deleted_at IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_updates' AND policyname='cf_campaign_updates_author') THEN
    CREATE POLICY cf_campaign_updates_author ON public.cf_campaign_updates FOR ALL TO authenticated
      USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_update_likes' AND policyname='cf_update_likes_service') THEN
    CREATE POLICY cf_update_likes_service ON public.cf_update_likes FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_update_likes' AND policyname='cf_update_likes_read') THEN
    CREATE POLICY cf_update_likes_read ON public.cf_update_likes FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_update_likes' AND policyname='cf_update_likes_own') THEN
    CREATE POLICY cf_update_likes_own ON public.cf_update_likes FOR ALL TO authenticated
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

COMMENT ON TABLE public.cf_campaign_updates IS
  'Creator updates posted to a campaign''s backers. Only the campaign creator may publish; the service enforces it.';
COMMENT ON TABLE public.cf_update_likes IS
  'One row per (update, user). likeCount is a COUNT over this table, never a counter column, so it cannot drift.';
