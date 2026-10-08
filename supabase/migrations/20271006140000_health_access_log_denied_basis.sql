-- health_record_access_log.access_basis CHECK widening.
--
-- records.service logs EVERY PHI read — including DENIED cross-patient
-- attempts (SC-005, §4.6) — under access_basis='DENIED' (BasisDenied). The
-- original CHECK (20260815000100_health_platform.sql) admits only
-- 'OWNER','CONSENT','ADMIN', so every denied-access audit insert failed the
-- constraint and was silently dropped (the denial itself still works — the
-- write is best-effort by design). Result: the immutable trail records
-- allowed reads but is blind to the IDOR probes it exists to catch.
--
-- Widening (not narrowing) — no column drops, no renames, no data touched.
-- Postgres has no ALTER CONSTRAINT; drop+re-add is the only widen path. The
-- auto-named constraint from the inline column CHECK is deterministic:
-- {table}_{column}_check.
ALTER TABLE public.health_record_access_log
  DROP CONSTRAINT IF EXISTS health_record_access_log_access_basis_check;
ALTER TABLE public.health_record_access_log
  ADD CONSTRAINT health_record_access_log_access_basis_check
  CHECK (access_basis IN ('OWNER','CONSENT','ADMIN','DENIED'));
