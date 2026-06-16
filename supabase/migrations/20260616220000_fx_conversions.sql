-- FX Lane A: Conversion records and settlement support tables.
-- Additive only.

CREATE TABLE IF NOT EXISTS public.fx_conversions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id),
  quote_id            uuid        REFERENCES public.fx_quotes(id),
  provider_txn_id     text,
  source_currency     char(3)     NOT NULL,
  target_currency     char(3)     NOT NULL,
  source_amount_kobo  bigint      NOT NULL CHECK (source_amount_kobo > 0),
  target_amount_minor bigint      NOT NULL CHECK (target_amount_minor > 0),
  rate                numeric(20,8) NOT NULL,
  fee_kobo            bigint      NOT NULL DEFAULT 0,
  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','completed','failed','reversed')),
  reference           text        NOT NULL,
  idempotency_key     text        NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fx_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own fx_conversions"
  ON public.fx_conversions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on fx_conversions"
  ON public.fx_conversions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fx_conversions_user ON public.fx_conversions(user_id);
CREATE INDEX IF NOT EXISTS idx_fx_conversions_reference ON public.fx_conversions(reference);

-- settlements: cross-vertical escrow table used by settlement engine.
CREATE TABLE IF NOT EXISTS public.settlements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       text        NOT NULL,
  module_type     text        NOT NULL,
  payer_id        uuid        NOT NULL REFERENCES auth.users(id),
  total_kobo      bigint      NOT NULL CHECK (total_kobo > 0),
  fee_kobo        bigint      NOT NULL DEFAULT 0,
  provider_kobo   bigint      NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'escrowed'
                  CHECK (status IN ('escrowed','releasing','settled','disputed','refunded')),
  escrowed_at     timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  idempotency_key text        NOT NULL UNIQUE
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on settlements"
  ON public.settlements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users can read own settlements"
  ON public.settlements FOR SELECT USING (auth.uid() = payer_id);

CREATE INDEX IF NOT EXISTS idx_settlements_payer ON public.settlements(payer_id);
CREATE INDEX IF NOT EXISTS idx_settlements_reference ON public.settlements(reference);

-- disputes: universal dispute table.
CREATE TABLE IF NOT EXISTS public.disputes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id),
  reference   text        NOT NULL,
  module_type text        NOT NULL,
  type        text        NOT NULL,
  description text        NOT NULL,
  evidence_urls text[]    DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','in_review','resolved','closed')),
  resolution  text        CHECK (resolution IN ('refunded','settled','dismissed')),
  admin_note  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on disputes"
  ON public.disputes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users can read own disputes"
  ON public.disputes FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_disputes_user ON public.disputes(user_id);
CREATE INDEX IF NOT EXISTS idx_disputes_reference ON public.disputes(reference);

-- ratings: universal rating table.
CREATE TABLE IF NOT EXISTS public.ratings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id        uuid        NOT NULL REFERENCES auth.users(id),
  entity_id       text        NOT NULL,
  entity_type     text        NOT NULL,
  transaction_ref text        NOT NULL,
  score           numeric(2,1) NOT NULL CHECK (score >= 1 AND score <= 5),
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rater_id, transaction_ref)
);

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on ratings"
  ON public.ratings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Public read ratings"
  ON public.ratings FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_ratings_entity ON public.ratings(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_ratings_rater ON public.ratings(rater_id);
