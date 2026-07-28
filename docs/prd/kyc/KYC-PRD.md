# Paymax — KYC Implementation PRD (Multi-Provider Adapters)

**Mode:** God Mode — decisive, build-ready. Locked architecture; open commercial knobs in §13.
**Project type:** **Brownfield** — extends the existing Paymax identity/auth/wallet system. Additive only.
**Providers (as adapters behind one gateway):** **Dojah · Smile ID · Youverify**
**Goal:** full CBN-tiered KYC — ID-number verification, ID+facial match, liveness/biometrics, document verification, and AML screening — with capability-based routing and failover across the three providers.

**Companion docs**
- `docs/provider-capability-matrix.md` — real endpoints per provider + routing/failover
- `docs/mobile-screens-and-workflows.md` — patient/customer KYC UI/UX + flows
- `docs/admin-console.md` — management console for review, config, monitoring
- `.env.local` — dummy sandbox credentials

---

## 1. The core idea: route by capability, not by provider

The three providers overlap but each is strongest somewhere. So the gateway never hard-binds a provider — it routes **per check type** to a configured primary with an ordered fallback chain (data-driven, editable from the admin console):

| Check type | Default primary → fallback | Why |
|---|---|---|
| ID-number data match (BVN/NIN/vNIN/passport/DL/PVC) | Youverify → Dojah | Both do clean number lookups; either covers it. |
| ID + facial match (BVN/NIN facial) | Youverify → Smile ID | Youverify `*_facial`; Smile Enhanced KYC + SmartSelfie. |
| Liveness / biometric selfie | Smile ID → Dojah | Smile's anti-spoof SDK is strongest; Dojah liveness fallback. |
| Document verification (OCR + authenticity + face-match) | Smile ID → Dojah | Smile Enhanced DocV; Dojah Document Analysis fallback. |
| AML / PEP screening | Dojah → Youverify | Both offer AML screening. |

Swapping a provider for any check is a **config change**, not code. A provider outage triggers automatic failover down the chain.

---

## 2. The unifying abstraction

Everything normalizes to a **VerificationCheck**:

```
VerificationCheck {
  id, session_id, type (ID_NUMBER|ID_FACIAL|LIVENESS|DOCUMENT|AML),
  provider, provider_ref, client_ref (idempotency),
  status (INITIATED|PENDING|PASSED|FAILED|REVIEW),
  result { match: bool, confidence: number, extracted_fields, reason },
  raw_payload_ref (encrypted blob store), created_at
}
```

Each adapter maps its provider's response into this shape. Domain logic reads only the normalized result, never provider-specific fields. This is what makes "three providers as adapters" actually clean.

---

## 3. CBN tiered KYC model

Reuse the existing Tier 0–3 concept; this module supplies the *checks* each tier needs:

| Tier | Required checks | Composed by orchestrator |
|---|---|---|
| 0 | phone/email | minimal |
| 1 | BVN **or** NIN data match | `ID_NUMBER` |
| 2 | Tier 1 + facial/liveness match | `ID_NUMBER` + (`ID_FACIAL` or `LIVENESS`) |
| 3 | Tier 2 + document verification + address + AML (EDD) | + `DOCUMENT` + address + `AML` |

The **orchestrator** composes the check set for a target tier, runs them through the gateway, and resolves the tier only when all required checks reach `PASSED`.

---

## 4. Verification state machine (guarded)

**Session level**
```
UNVERIFIED → TIER_n_PENDING ──all required checks PASSED──► TIER_n_VERIFIED
                 │                                   └─any FAILED──► TIER_n_FAILED → (retry)
                 └─any check REVIEW──► NEEDS_REVIEW ──admin──► APPROVED | REJECTED
```

**Check level**
```
INITIATED → PENDING ──webhook/callback──► PASSED | FAILED | REVIEW
```

- Terminal states reached via provider **callback/webhook** (authoritative), or a verified synchronous response where the provider returns inline.
- Illegal transitions are structurally blocked; tier never elevates without its full required set passing.
- Every transition is audited.

---

## 5. Async, webhooks & idempotency

- **Smile ID is callback-based** — results (and human-review outcomes) arrive async to `SMILEID_CALLBACK_URL`; verify signature (`confirm_signature`), dedupe, post.
- **Dojah & Youverify** support webhooks; some lookups also return synchronously. Treat the **webhook as authoritative** when both arrive (same pattern as the Maplerad module).
- One hardened ingestion endpoint per provider under `/api/kyc/webhooks/{provider}`: **verify signature → dedupe by event/job id → process idempotently → update check → audit**.
- Every provider call carries a **client_ref**; a retried call with the same ref never double-runs or double-charges the provider wallet.

---

## 6. Consent & data protection (NDPA / CBN) — non-negotiable

- **Explicit subject consent captured before any check.** Youverify requires `isSubjectConsent=true`; NDPA 2023 + CBN data policy apply to all three. Persist a consent record (what, when, version) per user.
- **PII encrypted at rest (AES-256), TLS 1.2+ in transit.** Raw provider payloads (which include photos, full bio-data) are stored in an encrypted blob store, referenced by `raw_payload_ref`, access-controlled and audited — minimized and retained per policy.
- Selfie/document images and government bio-data are sensitive: access is object-level (the user + authorized reviewers only) and every access is logged.
- Secret keys never reach the client — Smile/Youverify web flows use a server-issued token; Dojah secret is server-side only.

---

## 7. Reuse vs net-new (brownfield)

| Reuse | Net-new |
|---|---|
| Existing user/identity + auth | `KycGateway` ports + Dojah/SmileID/Youverify adapters |
| Existing Tier 0–3 concept + limits | `VerificationSession` + `VerificationCheck` entities |
| Audit infra; notifications | Orchestrator (tier → required checks) |
| Mobile design system | Webhook ingestion (`/api/kyc/webhooks/*`) |
| Vault/secrets, CI/CD | Capability routing + failover config |
| | Encrypted PII blob store + consent records |
| | Mobile KYC flow screens + Admin review console |

---

## 8. Repo changes (brownfield, additive)

```
/kyc
  /gateways              # ports: IdNumberPort, FacialPort, LivenessPort, DocumentPort, AmlPort
  /adapters
    /dojah  /smileid  /youverify    # each: client.ts, *.adapter.ts, mappers.ts
  /orchestrator          # tier → required checks → resolve
  /routing               # capability route + fallback resolver (reads env/admin config)
  /webhooks              # dojah.handler / smileid.handler / youverify.handler
  /store                 # encrypted PII blob + consent repository
config/kyc.config.ts     # env refs (no secret values)
```

Domain calls ports only; provider SDKs confined to `/adapters`. **Expand/contract** migrations add KYC tables + user columns (`kyc_tier`, `kyc_status`) without touching existing flows.

---

## 9. Data model (additive migrations)

- `verification_session` — `{user_id, target_tier, status, created_at}`
- `verification_check` — normalized check (see §2), FK to session
- `kyc_consent` — `{user_id, scope, version, granted_at, ip}`
- `kyc_provider_event` — webhook dedupe `{event_id unique, provider, payload_ref, processed_at}`
- `kyc_routing_rule` — `{check_type, ordered_providers[], threshold}` (admin-editable)
- user gains `kyc_tier`, `kyc_status`; PII blobs in encrypted store keyed by `raw_payload_ref`
- Constraints: `verification_check.client_ref` unique; `kyc_provider_event.event_id` unique

---

## 10. Security & observability

- Golden signals per provider: check success rate, latency, failover count, review rate, provider wallet balance.
- Circuit breaker + retry/backoff around each adapter; on breaker-open, route to next provider in the chain.
- Alerts: provider failure-rate spike, webhook lag, review-queue backlog, AML hit.
- Object-level authZ on every verification record; immutable audit on checks, consent, and admin decisions.

---

## 11. Brownfield rollout

1. **Sandbox** — wire all three adapters to provider sandboxes via `.env.local`; mock Smile sandbox results (`sandbox_result`), use Dojah test NUBAN, Youverify test data.
2. **Expand migrations** to staging; backfill existing users' `kyc_tier` from current state.
3. **Shadow run** — run new flow for a cohort behind a feature flag; compare outcomes to the existing process.
4. **Canary** in prod (live keys from vault), watch golden signals + review queue.
5. **Progressive rollout**; rehearsed flag-off fallback to the prior KYC path at every step.
6. **Contract** old KYC structures only after the new flow is stable.

---

## 12. Definition of done

- [ ] Domain calls gateway ports only; Dojah/SmileID/Youverify confined to `/adapters`
- [ ] Capability routing + automatic failover working; provider swap is config-only
- [ ] All checks normalize to `VerificationCheck`; domain reads normalized results only
- [ ] Tier orchestrator composes + resolves required checks per CBN tier
- [ ] Guarded session + check state machines; tier never elevates without full pass
- [ ] Webhooks verified, deduped, idempotent across all three providers
- [ ] Consent captured before any check; PII encrypted at rest; access object-level + audited
- [ ] Dummy `.env.local` runs the full flow against all three sandboxes
- [ ] Mobile flow (see docs) + Admin console (see docs) built on existing design system
- [ ] Expand/contract migrations with rollback; canary + flag rollout
- [ ] Tests: adapter mapping, routing/failover, state machines, webhook idempotency, consent gate, authZ
