-- ════════════════════════════════════════════════════════════════════════════
-- Commission & Platform-Charge Management — Spotlight/Paymax profit governance.
-- Source of truth for what Spotlight earns on every service:
--   • commission_bps       — provider discount (Spotlight revenue; provider bears)
--   • platform_charge_bps  — take-rate on the transaction (merchant/customer)
--   • convenience_fee_kobo  — flat fee the CUSTOMER pays on top
--   • fixed_fee_kobo        — flat per-transaction fee
-- Admin-managed (add/adjust services as the platform scales). Seeded from the
-- business commission workbook. ADDITIVE ONLY. Money = integer kobo / bps.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Rate registry (mutable via admin, every change audited) ───────────────
CREATE TABLE IF NOT EXISTS public.commission_config (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_category     text NOT NULL,
  service              text NOT NULL,
  service_subtype      text NOT NULL DEFAULT '',           -- '' = whole service
  fee_model            text NOT NULL DEFAULT 'none'
                        CHECK (fee_model IN ('commission','platform_charge','fixed','commission_plus_fee','none')),
  commission_bps       integer NOT NULL DEFAULT 0 CHECK (commission_bps       >= 0 AND commission_bps       <= 100000),
  platform_charge_bps  integer NOT NULL DEFAULT 0 CHECK (platform_charge_bps  >= 0 AND platform_charge_bps  <= 100000),
  convenience_fee_kobo bigint  NOT NULL DEFAULT 0 CHECK (convenience_fee_kobo >= 0),
  fixed_fee_kobo       bigint  NOT NULL DEFAULT 0 CHECK (fixed_fee_kobo       >= 0),
  fee_payer            text NOT NULL DEFAULT 'customer'
                        CHECK (fee_payer IN ('customer','provider','merchant','none')),
  currency             text NOT NULL DEFAULT 'NGN',
  active               boolean NOT NULL DEFAULT true,
  notes                text,
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_category, service, service_subtype)
);
CREATE INDEX IF NOT EXISTS idx_commission_config_lookup
  ON public.commission_config (service_category, service, service_subtype) WHERE active;

-- ── 2. Change audit (who changed which rate, before/after) ───────────────────
CREATE TABLE IF NOT EXISTS public.commission_config_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id   uuid,
  action      text NOT NULL CHECK (action IN ('create','update','activate','deactivate','delete')),
  before      jsonb,
  after       jsonb,
  changed_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commission_audit_config ON public.commission_config_audit (config_id, created_at);

-- ── 3. Realized earnings (append-only ledger of Spotlight profit per txn) ─────
CREATE TABLE IF NOT EXISTS public.commission_earnings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id              uuid REFERENCES public.commission_config(id),
  service_category       text NOT NULL,
  service                text NOT NULL,
  service_subtype        text NOT NULL DEFAULT '',
  gross_amount_kobo      bigint NOT NULL CHECK (gross_amount_kobo >= 0),
  commission_kobo        bigint NOT NULL DEFAULT 0,
  platform_charge_kobo   bigint NOT NULL DEFAULT 0,
  convenience_fee_kobo   bigint NOT NULL DEFAULT 0,
  fixed_fee_kobo         bigint NOT NULL DEFAULT 0,
  spotlight_revenue_kobo bigint NOT NULL,
  currency               text NOT NULL DEFAULT 'NGN',
  source_module          text NOT NULL,                    -- 'utility','marketplace',...
  source_ref             text NOT NULL,                    -- originating txn id
  ledger_ref             text,                             -- ledger entry ref, if posted
  user_id                uuid,
  idempotency_key        text UNIQUE,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commission_earnings_cat  ON public.commission_earnings (service_category, service, created_at);
CREATE INDEX IF NOT EXISTS idx_commission_earnings_time ON public.commission_earnings (created_at);
CREATE INDEX IF NOT EXISTS idx_commission_earnings_src  ON public.commission_earnings (source_module, source_ref);

-- Append-only guard on realized earnings (corrections = new reversing rows).
CREATE OR REPLACE FUNCTION public.commission_block_mutation() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'append-only table %: UPDATE/DELETE forbidden (post a reversing earning row)', TG_TABLE_NAME;
END;
$fn$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'commission_earnings_immutable') THEN
    CREATE TRIGGER commission_earnings_immutable BEFORE UPDATE OR DELETE ON public.commission_earnings
      FOR EACH ROW EXECUTE FUNCTION public.commission_block_mutation();
  END IF;
END $$;

-- ── 4. RLS: deny-by-default; service-role backend (pgxpool) does all writes ──
ALTER TABLE public.commission_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_config_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_earnings     ENABLE ROW LEVEL SECURITY;

-- ── 5. Seed from the business commission workbook (57 rows) ───────────────────
INSERT INTO public.commission_config
  (service_category, service, service_subtype, fee_model, commission_bps, platform_charge_bps, convenience_fee_kobo, fixed_fee_kobo, fee_payer)
VALUES
  ('Utility_Bills','Airtime','9mobile','commission',400,0,0,0,'provider'),
  ('Utility_Bills','Airtime','MTN','commission',300,0,0,0,'provider'),
  ('Utility_Bills','Airtime','GLO','commission',400,0,0,0,'provider'),
  ('Utility_Bills','Airtime','Airtel','commission',340,0,0,0,'provider'),
  ('Utility_Bills','Data','9mobile','commission',400,0,0,0,'provider'),
  ('Utility_Bills','Data','MTN','commission',300,0,0,0,'provider'),
  ('Utility_Bills','Data','GLO','commission',400,0,0,0,'provider'),
  ('Utility_Bills','Data','Airtel','commission',340,0,0,0,'provider'),
  ('Utility_Bills','Data','Smile','commission',500,0,0,0,'provider'),
  ('Utility_Bills','Data','Spectranet','commission',300,0,0,0,'provider'),
  ('Utility_Bills','Electricity','Abuja','commission_plus_fee',120,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Aba','commission_plus_fee',170,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Ikeja','commission_plus_fee',100,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Eko','commission_plus_fee',100,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Ibadan','commission_plus_fee',110,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Yola','commission_plus_fee',120,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Kano','commission_plus_fee',100,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Kaduna','commission_plus_fee',150,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Jos','commission_plus_fee',90,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Enugu','commission_plus_fee',140,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','Benin','commission_plus_fee',150,0,10000,0,'provider'),
  ('Utility_Bills','Electricity','PortHarcourt','commission_plus_fee',120,0,10000,0,'provider'),
  ('Utility_Bills','CableTv','DSTV','commission_plus_fee',150,0,10000,0,'provider'),
  ('Utility_Bills','CableTv','GoTV','commission_plus_fee',150,0,10000,0,'provider'),
  ('Utility_Bills','CableTv','Startime','commission_plus_fee',200,0,10000,0,'provider'),
  ('Utility_Bills','CableTv','Showmax','commission_plus_fee',150,0,10000,0,'provider'),
  ('Utility_Bills','Education','WAEC','fixed',0,0,0,25000,'customer'),
  ('Utility_Bills','Education','NECO','fixed',0,0,0,15000,'customer'),
  ('Utility_Bills','Education','JAMB','none',0,0,0,0,'none'),
  ('Lifestyle','Restaurant','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Grocery/Supermarket','','platform_charge',0,1000,0,0,'merchant'),
  ('Contest','Voting','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Event Tickets','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Delivery - Rider','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Taxi - Ride Hailing','','platform_charge',0,1000,0,0,'merchant'),
  ('Finance','Currency Exchange','','platform_charge',0,1000,0,0,'merchant'),
  ('Contest','StudyHub','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Bus Booking','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Car Hire','','platform_charge',0,1000,0,0,'merchant'),
  ('Health','Doctor','','platform_charge',0,1000,0,0,'merchant'),
  ('Health','Veterinary','','platform_charge',0,1000,0,0,'merchant'),
  ('Health','Lab','','platform_charge',0,1000,0,0,'merchant'),
  ('Health','Pharmacy','','platform_charge',0,1000,0,0,'merchant'),
  ('Community','Group Membership','','platform_charge',0,1000,0,0,'merchant'),
  ('Community','Crowdfunding','','platform_charge',0,1000,0,0,'merchant'),
  ('Property','Estate','','platform_charge',0,1000,0,0,'merchant'),
  ('Property','Hotel','','platform_charge',0,1000,0,0,'merchant'),
  ('Community','Job','','platform_charge',0,1000,0,0,'merchant'),
  ('Property','Property','','platform_charge',0,1000,0,0,'merchant'),
  ('Community','Naija Driver','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Marketplace','','platform_charge',0,1000,0,0,'merchant'),
  ('Lifestyle','Creators','','platform_charge',0,1000,0,0,'merchant'),
  ('Finance','Money Transfer','','platform_charge',0,1000,0,0,'merchant'),
  ('Finance','FX Exchange','','none',0,0,0,0,'none'),
  ('Finance','Savings','','platform_charge',0,1000,0,0,'merchant'),
  ('Finance','Social Pay','','platform_charge',0,1000,0,0,'merchant'),
  ('Finance','Referral rewards','','platform_charge',0,1000,0,0,'merchant')
ON CONFLICT (service_category, service, service_subtype) DO NOTHING;
