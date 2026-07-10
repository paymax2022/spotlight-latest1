-- FX Convert idempotency hardening (RISK-FX-2).
-- Additive-only, fully guarded, idempotent to re-apply.
--
-- The original table (20260616220000_fx_conversions.sql) already declares
-- `idempotency_key text NOT NULL UNIQUE`, so the fix in
-- backend/internal/finance/fx/service.go (INSERT ... ON CONFLICT (idempotency_key)
-- DO NOTHING) already has a durable guard. This migration exists to make that
-- guarantee EXPLICIT and to be a safety net for any environment where the inline
-- UNIQUE was somehow dropped or never applied. It creates a named UNIQUE index
-- only if no unique constraint/index already covers fx_conversions(idempotency_key).
--
-- No DROP, no rename, no type change. Safe on a table that already has the constraint.

DO $$
BEGIN
  -- Skip if any unique index already exists on exactly (idempotency_key).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c   ON c.oid = i.indrelid
    JOIN pg_class ic  ON ic.oid = i.indexrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
    WHERE c.relname = 'fx_conversions'
      AND c.relnamespace = 'public'::regnamespace
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'idempotency_key'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_conversions_idempotency_key '
         || 'ON public.fx_conversions (idempotency_key)';
  END IF;
END
$$;
