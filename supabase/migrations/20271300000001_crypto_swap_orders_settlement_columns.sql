-- Add settlement tracking columns to crypto_swap_orders
-- Supports quotation binding, provider webhooks, and ledger settlement
-- IF NOT EXISTS is required, not cosmetic: 20271200000041 already adds the five
-- shared columns, so a plain ADD COLUMN aborts a fresh migrate-up with
-- "column quotation_id already exists".

alter table crypto_swap_orders
add column if not exists quotation_id text,
add column if not exists swap_transaction_id text,
add column if not exists provider_status text,
add column if not exists ledger_settled boolean default false,
add column if not exists provider_response_at timestamptz,
add column if not exists final_status text,
add column if not exists settled_at timestamptz;

-- Index for efficient quotation lookups
create index if not exists idx_crypto_swap_orders_quotation_id
on crypto_swap_orders(quotation_id) where quotation_id is not null;

-- Index for provider webhook lookups
create index if not exists idx_crypto_swap_orders_provider_status
on crypto_swap_orders(swap_transaction_id) where swap_transaction_id is not null;

-- Index for settlement queries
create index if not exists idx_crypto_swap_orders_ledger_settled
on crypto_swap_orders(ledger_settled, user_id) where not ledger_settled;
