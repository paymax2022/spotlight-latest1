-- Migration: crossborder_recon (SP-3a Task 6 three-way reconciliation)
-- Run log + discrepancy ("break") register for the cross-border recon jobs.
-- EXPAND-only (additive). No DROP, no renames, no type narrowing.
--   * Backend-only tables: RLS enabled with no policies; service_role (Go pgx) writes.
--   * An OPEN break is unique on dedupe_key (check|type|ref_a|ref_b) so re-running a
--     job never duplicates a discrepancy; once resolved, a recurrence opens a new row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.crossborder_recon_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name      text        NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  breaks_detected integer     NOT NULL DEFAULT 0,
  breaks_created  integer     NOT NULL DEFAULT 0,
  redriven        integer     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS crossborder_recon_runs_check_idx
  ON public.crossborder_recon_runs (check_name, started_at DESC);

CREATE TABLE IF NOT EXISTS public.crossborder_recon_breaks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid        NOT NULL REFERENCES public.crossborder_recon_runs(id),
  check_name   text        NOT NULL,
  type         text        NOT NULL
               CHECK (type IN ('missing-in-provider','missing-in-ledger','missing-in-commission',
                               'amount-mismatch','status-mismatch','duplicate','recognition-gap')),
  severity     text        NOT NULL CHECK (severity IN ('low','medium','high')),
  ref_a        text        NOT NULL DEFAULT '',
  ref_b        text        NOT NULL DEFAULT '',
  delta_minor  bigint      NOT NULL DEFAULT 0,
  detail       text        NOT NULL DEFAULT '',
  dedupe_key   text        NOT NULL,
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  owner        text,
  resolved_at  timestamptz,
  resolution   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crossborder_recon_breaks_open_uq
  ON public.crossborder_recon_breaks (dedupe_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS crossborder_recon_breaks_status_idx
  ON public.crossborder_recon_breaks (status, severity, created_at DESC);

ALTER TABLE public.crossborder_recon_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crossborder_recon_breaks ENABLE ROW LEVEL SECURITY;

COMMIT;
