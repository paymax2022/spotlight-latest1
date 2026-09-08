-- Campaign comments and Q&A, with creator replies and reporting.
--
-- The mobile screen (app/crowdfunding/campaign/[id]/comments.tsx) and its API
-- client have existed for some time and call four endpoints that were never
-- built. Nothing persisted: no table, no Go routes, no proxy — the screen 404'd
-- on load and the only comments anyone ever saw came from a mock array.
--
-- Shape follows what the client already expects (CampaignComment / CommentReply
-- in crowdfunding.types.ts) rather than inventing a new contract:
--   · a comment belongs to a campaign, is written by a user, and may be flagged
--     as a QUESTION (the screen splits Comments / Q&A on exactly that bit);
--   · a REPLY is a comment with a parent. One table, self-referencing, because a
--     reply carries the same author/body/timestamp and differs only in position;
--   · `isCreator` is NOT stored. It is derived per row by comparing the author to
--     campaigns.creator_id, so it cannot drift if a campaign changes hands.
--
-- Reports are their own table rather than a boolean, so the same person cannot
-- report twice, moderation can count distinct reporters, and the client's
-- `reported` flag can mean "you reported this" rather than "somebody did".

CREATE TABLE IF NOT EXISTS public.cf_campaign_comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    -- NULL for a top-level comment; set for a reply. Depth is capped at one by
    -- the service (a reply may not itself be replied to), which the feed shape
    -- assumes: replies are nested one level under their parent and no further.
    parent_id   uuid REFERENCES public.cf_campaign_comments(id) ON DELETE CASCADE,
    author_id   uuid NOT NULL,
    body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
    is_question boolean NOT NULL DEFAULT false,
    -- Soft delete: a removed comment must not orphan the replies hanging off it,
    -- and moderation wants the row for audit.
    deleted_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The feed read: newest first within a campaign. id breaks created_at ties so
-- pagination cannot skip or repeat a row when two land in the same millisecond.
CREATE INDEX IF NOT EXISTS cf_campaign_comments_feed_idx
    ON public.cf_campaign_comments (campaign_id, created_at DESC, id DESC)
 WHERE deleted_at IS NULL;

-- Reply lookup for a page of parents.
CREATE INDEX IF NOT EXISTS cf_campaign_comments_parent_idx
    ON public.cf_campaign_comments (parent_id)
 WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cf_comment_reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id  uuid NOT NULL REFERENCES public.cf_campaign_comments(id) ON DELETE CASCADE,
    reporter_id uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- One report per person per comment. This is what makes POST /report idempotent:
-- a double tap is ON CONFLICT DO NOTHING rather than a second row.
CREATE UNIQUE INDEX IF NOT EXISTS cf_comment_reports_once_idx
    ON public.cf_comment_reports (comment_id, reporter_id);

ALTER TABLE public.cf_campaign_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cf_comment_reports  ENABLE ROW LEVEL SECURITY;

-- Mirrors cf_support_tickets: the Go backend holds the service role and does its
-- own authorization, while a direct PostgREST caller is confined to rows it owns.
-- Comments differ from tickets in one way — reading is public, because a campaign
-- page shows its comments to everyone — so SELECT is open and only writes are
-- restricted to the author.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_comments' AND policyname='cf_campaign_comments_service') THEN
    CREATE POLICY cf_campaign_comments_service ON public.cf_campaign_comments FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_comments' AND policyname='cf_campaign_comments_read') THEN
    CREATE POLICY cf_campaign_comments_read ON public.cf_campaign_comments FOR SELECT TO authenticated, anon USING (deleted_at IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_comments' AND policyname='cf_campaign_comments_author') THEN
    CREATE POLICY cf_campaign_comments_author ON public.cf_campaign_comments FOR ALL TO authenticated
      USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_comment_reports' AND policyname='cf_comment_reports_service') THEN
    CREATE POLICY cf_comment_reports_service ON public.cf_comment_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_comment_reports' AND policyname='cf_comment_reports_own') THEN
    CREATE POLICY cf_comment_reports_own ON public.cf_comment_reports FOR ALL TO authenticated
      USING (reporter_id = auth.uid()) WITH CHECK (reporter_id = auth.uid());
  END IF;
END $$;

COMMENT ON TABLE public.cf_campaign_comments IS
  'Campaign comments and Q&A. A reply is a row with parent_id set; depth is capped at one by the service. isCreator is derived against campaigns.creator_id, never stored.';
COMMENT ON TABLE public.cf_comment_reports IS
  'One row per (comment, reporter). The unique index is what makes reporting idempotent.';
