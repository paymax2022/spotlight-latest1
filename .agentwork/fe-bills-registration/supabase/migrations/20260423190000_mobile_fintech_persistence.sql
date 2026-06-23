-- Mobile Fintech persistence layer (Phase 3)

CREATE TABLE IF NOT EXISTS public.mobile_fintech_accounts (
  user_id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  currency TEXT NOT NULL DEFAULT 'NGN',
  available_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ledger_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  kyc_status TEXT NOT NULL DEFAULT 'not_started' CHECK (kyc_status IN ('not_started','in_review','verified','rejected')),
  card_controls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mobile_fintech_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('virtual','physical')),
  masked_pan TEXT NOT NULL,
  expiry TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','inactive')),
  spending_limit_daily NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_fintech_cards_user_id ON public.mobile_fintech_cards(user_id);

CREATE TABLE IF NOT EXISTS public.mobile_fintech_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('credit','debit','pending','failed')),
  title TEXT NOT NULL,
  timestamp_label TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status_label TEXT NOT NULL,
  reference TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_fintech_transactions_user_id_created_at
  ON public.mobile_fintech_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mobile_fintech_transfer_reviews (
  review_token TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  recipient_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  fee NUMERIC(14,2) NOT NULL,
  total_debit NUMERIC(14,2) NOT NULL,
  reference_preview TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mobile_fintech_transfer_reviews_user_id
  ON public.mobile_fintech_transfer_reviews(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mobile_fintech_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  review_token TEXT NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','pending')),
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_fintech_transfers_user_id_created_at
  ON public.mobile_fintech_transfers(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mobile_fintech_bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  biller TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_fintech_bill_payments_user_id_created_at
  ON public.mobile_fintech_bill_payments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mobile_fintech_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  transaction_reference TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_fintech_support_tickets_user_id_created_at
  ON public.mobile_fintech_support_tickets(user_id, created_at DESC);

ALTER TABLE public.mobile_fintech_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_fintech_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_fintech_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_fintech_transfer_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_fintech_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_fintech_bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_fintech_support_tickets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_fintech_accounts' AND policyname = 'mobile_fintech_accounts_user_select'
  ) THEN
    CREATE POLICY mobile_fintech_accounts_user_select
      ON public.mobile_fintech_accounts FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_fintech_cards' AND policyname = 'mobile_fintech_cards_user_select'
  ) THEN
    CREATE POLICY mobile_fintech_cards_user_select
      ON public.mobile_fintech_cards FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_fintech_transactions' AND policyname = 'mobile_fintech_transactions_user_select'
  ) THEN
    CREATE POLICY mobile_fintech_transactions_user_select
      ON public.mobile_fintech_transactions FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_fintech_transfer_reviews' AND policyname = 'mobile_fintech_transfer_reviews_user_select'
  ) THEN
    CREATE POLICY mobile_fintech_transfer_reviews_user_select
      ON public.mobile_fintech_transfer_reviews FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_fintech_transfers' AND policyname = 'mobile_fintech_transfers_user_select'
  ) THEN
    CREATE POLICY mobile_fintech_transfers_user_select
      ON public.mobile_fintech_transfers FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_fintech_bill_payments' AND policyname = 'mobile_fintech_bill_payments_user_select'
  ) THEN
    CREATE POLICY mobile_fintech_bill_payments_user_select
      ON public.mobile_fintech_bill_payments FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_fintech_support_tickets' AND policyname = 'mobile_fintech_support_tickets_user_select'
  ) THEN
    CREATE POLICY mobile_fintech_support_tickets_user_select
      ON public.mobile_fintech_support_tickets FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
