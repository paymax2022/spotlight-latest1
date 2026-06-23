# Paymax Connect — Compliance & Safety (§6, §24)

Maps each non-negotiable invariant from `dating/CLAUDE.md §28` to a concrete control in the
brownfield stack. None may be weakened to ship.

| # | Invariant | Control (where it lives) |
|---|---|---|
| 1 | **18+ only** | `POST /onboarding/age-gate` captures DOB; service computes age fail-closed; suspected minors written to `connect_underage_flags` and surfaced in admin queue. No under-18 mode exists in `connect_profile_modes`. |
| 2 | **No prohibited surfaces** | No escort/companionship/solicitation features in scope (`product.md §5.2`); financial-solicitation language detector (invariant 10) flags attempts. |
| 3 | **Location privacy** | `privacy.location` defaults to approximate; exact location requires trust threshold + explicit opt-in via `PATCH /privacy/location`. Distance in search is bucketed. |
| 4 | **No messaging before mutual match** | Enforced in `chat` service state machine **and** as a DB backstop (message insert requires `matched` + `open` conversation). Only moderated, rate-limited intro flows excepted. |
| 5 | **Verification data encrypted at rest, retention defined, never logged** | `connect_verification.evidence_ref` stored via encryption hook; raw documents never in plaintext columns; logger redaction; retention job purges per policy. |
| 6 | **Every admin action audited** | `connect_audit_log` + `admin_audit_logs` written with admin id, role, action, entity, old/new, reason, IP, ts via `audit_service.LogAction`. |
| 7 | **Every report creates a case; flows never fail silently** | `POST /safety/report` transactionally inserts a `connect_case`; handler returns the case id; failures bubble as 5xx, never swallowed. |
| 8 | **AI moderation stores reason codes; moderator-only review** | `connect_moderation_decisions.reason_codes`; reads gated by `connect.moderation.read` RBAC + `is_admin()` RLS. |
| 9 | **Media moderated before public visibility** | `connect_profile_media.moderation_status` starts `pending`; async worker sets `approved` before any public read; RLS hides non-approved media from others. |
| 10 | **Financial-solicitation language triggers warnings** | Safety hook on message send scores money/gift-card/crypto/emergency-fund/off-platform scripts; warns user, flags conversation, opens case on repeat. |
| 11 | **Payments only via Paymax; entitlements server-side** | All Phase 6 money flows call `internal/finance/wallet`+`ledger` with Idempotency-Key; entitlement checks server-side, never trusted from mobile. |

## §24 MVP "Must Not Have" (never implement)
Teen mode; escort/adult-service marketplace; paid companionship; user-to-user money/crypto/loan
solicitation; exact location by default; pre-match messaging; unmoderated public media; client-side
entitlement or moderation-rule enforcement; plaintext storage or logging of verification PII.

## Retention & encryption
- Verification evidence: encrypted at rest; access via service role only; retention window defined
  in `connect_config` (`verification.retention_days`); purge job audited.
- Audit/case/moderation tables are append-only; corrections are new rows.

## Sensitive-topic note
This module handles safety, harassment, and abuse-reporting flows. Reporting and crisis-adjacent
paths must surface support resources where appropriate and must never be silently dropped.
