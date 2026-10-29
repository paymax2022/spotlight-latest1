-- Add settlement tracking columns to crypto_swap_orders
-- Supports quotation binding, provider webhooks, and ledger settlement

alter table crypto_swap_orders
add column quotation_id text,
add column swap_transaction_id text,
add column provider_status text,
add column ledger_settled boolean default false,
add column provider_response_at timestamptz,
add column final_status text,
add column settled_at timestamptz;

-- Index for efficient quotation lookups
create index if not exists idx_crypto_swap_orders_quotation_id
on crypto_swap_orders(quotation_id) where quotation_id is not null;

-- Index for provider webhook lookups
create index if not exists idx_crypto_swap_orders_provider_status
on crypto_swap_orders(swap_transaction_id) where swap_transaction_id is not null;

-- Index for settlement queries
create index if not exists idx_crypto_swap_orders_ledger_settled
on crypto_swap_orders(ledger_settled, user_id) where not ledger_settled;
