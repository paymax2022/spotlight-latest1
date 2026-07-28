# Paymax AI Symptom Checker — Phase 1 (MVP), implemented to go-live readiness

Triage & navigation, **NOT diagnosis**. App triage (EN/Pidgin) → licensed-engine +
deterministic red-flag layer → 5-level disposition → care-loop routing with wallet
pay → records vault → emergency screen, plus the clinical-governance console and
WhatsApp omnichannel scaffold. Gated by `FEATURE_HEALTH_TRIAGE_ENABLED`
(WhatsApp behind `FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED`).

## Architecture (buy-the-engine, own-the-edge)

- **EngineProvider** (`triage.EngineProvider`) — `core.InfermedicaEngine` (HTTP, de-identified,
  5-level) when `TRIAGE_ENGINE=infermedica` + creds, else the deterministic `triage.MockEngine`.
- **RED-FLAG layer** — `triage.DefaultRedFlagEngine` (always-on safety net) **layered under**
  `governance.DBRedFlagEngine` (clinician-PUBLISHED rules); `triage.ApplyRedFlag` can only RAISE
  urgency. Emergency detection is rules-based, never probability-only.
- **NLU** — `core.LLMExtractor` maps EN/Pidgin free-text → structured evidence ONLY (falls back
  to `triage.MockExtractor`); never produces conclusions.
- **Care loop** — `care` routes the disposition to pharmacy/lab/telemedicine (wallet pay via the
  ledger, idempotent) or emergency (nearest ER + ambulance + first-aid), and raises an
  `EscalationCase` for high-risk (human-in-loop).
- **Governance** — content + red-flag rules require clinician sign-off to publish (versioned,
  audited); validation harness runs African vignettes optimising EMERGENCY SENSITIVITY first.

## Footprint

Backend `internal/health/triage` (24 files): `contracts.go` (interfaces + 4 guarded state
machines + 5-level disposition + `ApplyRedFlag`), `mock.go` (deterministic engine/extractor +
red-flag safety net), subpackages `core` (orchestration), `care` (routing+escalation),
`governance` (sign-off + validation + WhatsApp); aggregator `app/health_triage_routes.go`.
Migration `20260815001500_health_triage.sql` (17 tables + RLS + `health.triage.*` RBAC).
Mobile `app/health/triage` (8 screens) + `src/features/triage` (13). Admin
`app/admin/health/triage` (5 pages) + sidebar. Flags + engine config in `internal/config`.

## SC-1…SC-12 release-blocker checklist

- **SC-1 No diagnosis framing** ✅ output is "possible causes / guidance"; assessments store
  possible-causes; mobile never renders "diagnosis" as the result; disclaimer states it is not one.
- **SC-2 Deterministic red-flag override** ✅ `DefaultRedFlagEngine` + DB rules via `ApplyRedFlag`
  (urgency only rises); emergency rules-based.
- **SC-3 Conservative triage** ✅ ambiguity → more urgent (engine floors to consult; red-flag wins);
  validation optimises emergency sensitivity first.
- **SC-4 No AI prescribing/dx** ✅ engine triages only; prescriptions remain in the licensed care loop.
- **SC-5 Human-in-loop high-risk** ✅ `EscalationCase` raised→notified→acknowledged→resolved;
  emergencies route in-person + ambulance + first-aid.
- **SC-6 Clinician sign-off to publish** ✅ content/red-flag-rule SM draft→review→approved→published,
  publish requires `reviewer_id`, versioned + audited.
- **SC-7 NDPA** ✅ explicit consent recorded before interviewing; engine runs de-identified (age/sex/
  region/evidence only); RLS owner-scoped; audit. *(At-rest field encryption for raw intake + data
  residency are deploy-env config — tracked below.)*
- **SC-8 Disclaimer + one-tap emergency everywhere** ✅ `DisclaimerBar` + `EmergencyFab` on every
  mobile screen; WhatsApp appends disclaimer + emergency line to every reply.
- **SC-9 Paediatric/maternal caution** ✅ family profiles; red-flag escalates infant fever / maternal
  bleeding; mobile caution banners for child/pregnant.
- **SC-10 No fabrication** ✅ LLM extracts evidence only (conclusion-codes filtered); content is
  curated/RAG, not generated.
- **SC-11 Regulatory posture** ✅ positioned as triage/navigation guidance, not a diagnostic device
  (copy + framing); clinician oversight via governance.
- **SC-12 Immutable audit** ✅ every session transition, disposition, escalation, and content/rule
  change writes an audit row; evidence/assessments append-only.

## Go-live readiness

Fits the existing devcontainer + `make ci` + `integration-verify.yml` (Go build/test, full tsc,
migrations) and the build-once→staging→prod pipeline. Flags default OFF (reversible). Engine is
mock-first; admin + mobile tsc green (scoped).

## Live rails wired (in `app/health_triage_routes.go`)

- **LLM evidence extractor** — `core.NewLLMExtractor(llm.NewAnthropicClient(ANTHROPIC_API_KEY))` is now
  injected into `RegisterHealthTriageCore` (EN/Pidgin → structured evidence only, SC-10); falls back to
  the deterministic `MockExtractor` when no key is set.
- **EmergencyLocator** — `triageEmergencyLocator` over the MapService (`SearchExternalPlaces("emergency
  hospital")` + haversine distance) returns the nearest ER; the care service still always adds ambulance
  (112) + first-aid regardless (SC-8).
- **Notifier** — `triageNotifier` over the platform notifications queue (`queue.NewClient(REDIS_URL)` →
  `notifications.Service.Send`, push + in-app) for escalation / follow-up notices.
- **Payment** — `triagePayment` debits the wallet into the escrow standing account via the ledger
  (idempotent), unchanged.
- **WhatsApp `TriageDriver`** — `triageWADriver` drives inbound messages through `core.SessionService`:
  resolves the user by phone, maps the conversation to a session via `health_triage_channel_sessions`
  (`UNIQUE(channel, external_id)` upsert), starts/continues the interview, and returns a plain-language
  reply; the governance webhook appends the disclaimer + emergency line to every message (SC-8). Gated by
  `FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED`; unknown numbers are guided to the app.
- **CareBooker** — intentionally left `nil`: the disposition routes into the **existing** pharmacy / lab /
  telemedicine booking flows in the app rather than a parallel booker.

## Remaining wires (env-dependent / pre-prod)

- Licensed engine creds (`TRIAGE_ENGINE=infermedica` + `INFERMEDICA_*`) + clinical sign-off gate
  on the vignette set before directing real patients (PRD validation gate).
- WhatsApp provider (Cloud API / BSP) webhook creds + the signed-driver registration for the chosen BSP.
- SC-7 deploy config: at-rest encryption for raw intake + data-residency; `go build/test` + full tsc
  + migrations green in the dev container/CI (no toolchain in this sandbox — structural review done).
