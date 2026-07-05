# ADR-013 — Multi-provider KYC verification gateway

**Status:** Accepted · **Date:** 2026-07-01 · **Scope:** brownfield, additive

## Context
CBN-tiered KYC needs ID-number match, ID+facial, liveness, document verification,
and AML screening across three providers (Dojah, Smile ID, Youverify), each
strongest at different checks. We already have a KYC core (`user_profiles.kyc_tier/
kyc_status`, `kyc_events` audit, `kyc/service.go`, admin page, mobile `app/kyc.tsx`)
and provider-agnostic patterns (PaymentProvider, MapService, Maplerad webhook).

## Decision
Add a **capability-routed verification gateway** on top of the existing KYC core,
never hard-binding a provider.

1. **Ports, not providers.** Define check-scoped ports in `internal/provider`
   (`IdNumberPort`, `FacialPort`, `LivenessPort`, `DocumentPort`, `AmlPort`,
   `KycWebhookParser`). Adapters (`internal/provider/{dojah,smileid,youverify}`)
   implement only what they serve. Everything normalizes to
   `provider.KycCheckResult`; the domain never sees a provider DTO.

2. **Domain in `internal/finance/kycverify`.** Guarded session + check state
   machines; a tier orchestrator that composes the required check set per target
   tier and resolves the tier only when the full set passes; capability routing
   with ordered failover; encrypted PII blob store + consent repo; hardened
   webhook ingestion at `/api/kyc/webhooks/{provider}`.

3. **Routing is data.** `kyc_routing_rule` (seeded from `KYC_ROUTE_*` env, edited
   in admin) gives an ordered provider chain per check type. On adapter error or
   open circuit breaker, advance to the next provider and record a failover event.
   Swapping a provider is config-only.

4. **Webhook authoritative + idempotent.** Reuse `webhook_event` (unique
   `(provider,event_id)`) for dedupe. Verify signature → dedupe → process
   idempotently → update check → audit. Sync provider responses set `PENDING`
   unless authoritative inline; the webhook/callback sets the terminal state.

5. **PII encrypted at rest.** New `internal/platform/crypto` (AES-256-GCM). Raw
   provider payloads (photos, bio-data) are encrypted app-side and stored in
   `kyc_pii_blob` (service-role only), referenced by `verification_check.
   raw_payload_ref`. Consent (`kyc_consent`) is captured before any check.

6. **Secrets server-side only.** Dojah/Smile/Youverify secrets live in backend
   config; web/mobile SDK capture uses a server-issued token. `Config.Validate()`
   requires a PII key + ≥1 provider when `FEATURE_KYC_VERIFY_ENABLED=true` in prod.

## Deviations from the PRD
- **Dedupe table:** reuse existing `webhook_event` instead of a separate
  `kyc_provider_event` — it is already provider-scoped with the right unique
  constraint (less schema sprawl).
- **PII store:** encrypted ciphertext in `kyc_pii_blob` (DB, RLS service-role
  only) rather than the R2 object store, keeping the blob authenticated-encrypted
  and access-logged in one place. R2 remains available if large-media offload is
  needed later.

## Consequences
- Provider outages fail over automatically; provider swap is a config edit.
- Feature-flagged (`FEATURE_KYC_VERIFY_ENABLED`, default OFF) → no flag, no path.
- Additive migrations only; existing KYC flow untouched (shadow-run then cutover).
- Below-threshold facial results go to REVIEW (human), never a silent fail.
