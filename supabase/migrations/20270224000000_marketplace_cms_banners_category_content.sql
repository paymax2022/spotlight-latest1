-- ════════════════════════════════════════════════════════════════════════════
-- Marketplace admin CMS (MKT-007): home banners + per-category landing/SEO
-- content (ADM-003/ADM-004). Additive only.
--
-- Before this migration the admin console's CMS page
-- (frontend-admin/app/admin/marketplace/cms/page.tsx) and its client
-- (frontend-admin/src/services/marketplaceAdminService.ts listBanners/
-- createBanner/updateBanner/setBannerStatus/getCategoryContent/
-- upsertCategoryContent) called backend routes that never existed (404) —
-- confirmed via psql \dt that neither table existed either.
--
-- Banner "status" is DERIVED at read time, not fully persisted: only two
-- states are stored (draft, archived) and the app-layer computes
-- scheduled/live/expired from start_at/end_at vs now(). This matches the
-- console's own Restore/Archive actions, which only ever set 'draft' or
-- 'archived' (see MktBannerStatus + the PATCH .../status handler).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mkt_banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot        TEXT NOT NULL CHECK (slot IN ('home_hero','home_strip','category_top')),
  title       TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT '',
  image_url   TEXT NOT NULL DEFAULT '',
  cta_label   TEXT NOT NULL DEFAULT '',
  cta_type    TEXT NOT NULL DEFAULT 'none' CHECK (cta_type IN ('none','category','search','listing','external')),
  cta_value   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','archived')), -- scheduled/live/expired are derived, not stored
  start_at    TIMESTAMPTZ,
  end_at      TIMESTAMPTZ,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  UUID,
  updated_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_banners_slot_sort ON public.mkt_banners(slot, sort_order);
CREATE INDEX IF NOT EXISTS idx_banners_status ON public.mkt_banners(status);

CREATE TABLE IF NOT EXISTS public.mkt_category_content (
  category_id      UUID PRIMARY KEY REFERENCES public.mkt_categories(id),
  hero_heading     TEXT NOT NULL DEFAULT '',
  intro_copy       TEXT NOT NULL DEFAULT '',
  seo_title        TEXT NOT NULL DEFAULT '',
  seo_description  TEXT NOT NULL DEFAULT '',
  updated_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: deny-by-default, same posture as mkt_boost_packages/mkt_boost_daily_rate
-- (20270168000000_marketplace_boost_pricing_config.sql) — the Go service
-- (pgxpool, service-role) does all reads/writes; no client-facing policy is
-- added because no member/mobile surface reads banners or category content
-- yet (grepped mobile-app/reactnative/src/features/marketplace/ — no banner
-- display component exists to need public read access).
ALTER TABLE public.mkt_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mkt_category_content ENABLE ROW LEVEL SECURITY;
