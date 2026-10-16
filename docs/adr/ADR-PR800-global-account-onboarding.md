# ADR-PR800: Global Account onboarding models individuals as sole-trader entities

- **Status:** Proposed
- **Date:** 2026-10-16
- **Module:** crossborder/onboarding (SP-2, Verto Global Account)
- **Flag:** dark behind `FEATURE_SPOTLIGHT_GLOBAL`

## Context

Verto's known sub-account onboarding schema is company/shareholder shaped. We
must onboard two user types: individuals and businesses. No native individual
endpoint is confirmed.

## Decision (D1)

Onboard an **individual as a one-person sole-trader entity**: the user is the
sole director, 100% UBO and controlling officer, mapped onto Verto's
company/shareholder schema. **Businesses** use the full company + UBO >= 25%
path. One `subjectType` domain and one mapper serve both.

Alternatives considered:

- **Business-only, gate individuals out.** Rejected: ships half the user base
  and defers the individual path with no new information.
- **Provider-agnostic, defer the individual mapping.** Rejected: nothing is
  built against the one schema we actually know.

Sole-prop was chosen because it ships both user types now against the known
schema, and if Verto later confirms a native individual endpoint it is a thin
adapter swap behind the existing mapper.

## Consequences / go-live gates

1. **Address and nationality have no persisted source today.** Individual
   activation fails closed (422) and no Verto account is created until they are
   captured and persisted (e.g. extend `SaveVerifiedIdentity` or a profile
   form) in SP-4 / before go-live. Businesses supply them in the request body.
2. **T&C consent is not recorded before ACTIVE on the approved -> ACTIVE path**
   (spec section 5 permits it). `AcceptTnC` and `onboarding_consents` are dormant
   in SP-2. Needs a compliance decision: accept ACTIVE-without-recorded-consent,
   or wire an AWAITING_TNC signal. Behaviour is pinned by
   `TestHandleProviderStatus_ApprovalRecordsNoConsent`.
3. **Cross-process double-activation window.** Two pods can each call
   `CreateSubAccount` before the DB idempotency insert, orphaning the second
   sub-account (ERROR-logged). Needs a Verto idempotency key (V16) or a
   reconcile sweep; the orphan log must feed a reconciler.
4. **Verto payload is modeled, not verified.** Flat struct plus `Extra` JSON for
   shareholders/products/risk; wire shapes, webhook signing, event vocabulary,
   and doc-type/risk IDs are unverified. Sandbox gates V6/V7/V8/V11 must pass
   before enabling `FEATURE_SPOTLIGHT_GLOBAL`.
