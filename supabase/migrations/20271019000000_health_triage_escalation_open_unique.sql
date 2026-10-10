-- ADR-PR646: one open escalation per triage session.
-- CareService.Raise dedupes to a single live case per session, but the
-- check-then-insert pair races under concurrent emergency Refers — two open
-- escalations meant two clinician broadcasts for one session. A partial
-- unique index makes the dedupe atomic at the storage layer; the insert
-- path folds a 23505 to the existing row (GetOpenEscalationBySession).
CREATE UNIQUE INDEX IF NOT EXISTS health_triage_escalations_one_open_per_session
  ON public.health_triage_escalations (session_id)
  WHERE state IN ('raised','notified','acknowledged');
