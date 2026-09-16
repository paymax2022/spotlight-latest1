-- Supporting evidence attached to a campaign.
--
-- Unlike milestones, budget, reward tiers and the beneficiary, this one was not a
-- case of the server discarding what the wizard collected: NOTHING collected it.
-- `documentLabels` exists on the draft and is only ever initialised and reset —
-- no step writes it, there is no documents screen in the wizard, and the campaign
-- Documents screen is a read-only list of a field GetDetail hardcoded to empty.
-- So this adds the storage AND the path that puts something in it.
--
-- The bytes live in R2 (crowdfunding/documents/<user>/<uuid><ext>) via the same
-- proxy-upload route the campaign cover already uses; this table holds only the
-- reference and what the list needs to render.

CREATE TABLE IF NOT EXISTS public.cf_campaign_documents (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    -- Who attached it. Only the campaign's creator may, which the service enforces.
    uploader_id uuid NOT NULL,
    label       text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 140),
    -- 'pdf' or 'image' — the two the client renders an icon for. Derived from the
    -- uploaded file server-side, never taken from the caller.
    doc_type    text NOT NULL CHECK (doc_type IN ('pdf','image')),
    -- The object key in R2 and the URL the app fetches it through. Both are kept:
    -- the key is what identifies the object for deletion or re-signing, the URL is
    -- what the client renders, and deriving one from the other later would bake in
    -- today's route shape.
    storage_key text NOT NULL,
    url         text NOT NULL,
    size_bytes  bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    -- Granted by review, never asserted by the uploader — same rule as the
    -- beneficiary's badge. A backer reads it as "somebody checked this document".
    verified    boolean NOT NULL DEFAULT false,
    verified_at timestamptz,
    verified_by uuid,
    sort_order  integer NOT NULL DEFAULT 0,
    deleted_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cf_campaign_documents_campaign_idx
    ON public.cf_campaign_documents (campaign_id, sort_order, created_at)
 WHERE deleted_at IS NULL;

-- One row per object: re-attaching the same upload is the same document, not a
-- second copy of it in the list.
CREATE UNIQUE INDEX IF NOT EXISTS cf_campaign_documents_key_idx
    ON public.cf_campaign_documents (campaign_id, storage_key);

ALTER TABLE public.cf_campaign_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_documents' AND policyname='cf_campaign_documents_service') THEN
    CREATE POLICY cf_campaign_documents_service ON public.cf_campaign_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  -- The Documents screen is headed "Supporting evidence for this campaign" and is
  -- shown to every visitor, so the LIST is public by product intent. Note this is
  -- metadata only — the bytes are reached through the upload route, and anything
  -- genuinely sensitive should not be attached to a public fundraiser at all.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_documents' AND policyname='cf_campaign_documents_read') THEN
    CREATE POLICY cf_campaign_documents_read ON public.cf_campaign_documents FOR SELECT TO authenticated, anon USING (deleted_at IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_documents' AND policyname='cf_campaign_documents_owner') THEN
    CREATE POLICY cf_campaign_documents_owner ON public.cf_campaign_documents FOR ALL TO authenticated
      USING (uploader_id = auth.uid()) WITH CHECK (uploader_id = auth.uid());
  END IF;
END $$;

COMMENT ON TABLE public.cf_campaign_documents IS
  'Supporting documents attached to a campaign. Bytes live in R2; this holds the reference. `verified` is granted by review, never by the uploader.';
