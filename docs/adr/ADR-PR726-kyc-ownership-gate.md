# ADR-PR726: NIN/BVN ownership gate — bind a PASSED ID-number check to the caller's verified phone

- **Status:** Accepted
- **Date:** 2026-10-12
- **Module:** kyc / kycverify (identity path)
- **Flag:** `FEATURE_KYC_OWNERSHIP_GATE` (default off)
- **Follow-up to:** ADR-PR722

## Context

A Dojah ID-number data-match (`kycverify.RunCheck` → `VerifyIDNumber`) proves an
ID is **real and authentic** — it does **not** prove the person submitting it
**owns** it. The match keys off the ID number alone and never binds it to the
caller. Two problems follow:

1. **"Any valid NIN → Tier 1."** On `main` today, anyone holding a valid NIN/BVN
   (their own or a stranger's) reaches CBN Tier 1.
2. **NIN → identity disclosure oracle.** ADR-PR722 persists the provider-returned
   legal name + DOB onto `user_profiles` on a PASSED check. Because the flow never
   binds the NIN to the caller, a submitted NIN becomes a one-shot
   NIN→name/DOB disclosure. ADR-PR722 mitigated this with first-write-wins but
   left a fresh/empty-profile residual and named a NIN-ownership gate as the root
   fix. This ADR is that gate.

## Decision

Add an **ownership gate** (flag `FEATURE_KYC_OWNERSHIP_GATE`, default off) that
binds the submitted ID to the caller by **phone**.

**1. Match the ID's registered phone against the account's verified phone.**
NIN/BVN/vNIN provider records carry the phone the ID is registered to (NIN →
`phone_number`; BVN-full → `phone_number1`/`phone_number2`; flattened into
`ExtractedFields`). The gate compares that against the caller's own
`user_profiles.phone` where `phone_verified = true`. Both sides are normalized
with `services.NormalizePhone` — the canonical 10-digit NSN form already used by
sign-in and the `user_profiles_phone_nsn_idx` index — so `+234…`, `0…` and bare
NSN forms all compare equal.

**2. Gate upstream of the status write.** The gate runs in `RunCheck` after the
provider result is sealed but **before** the check status is persisted, so a
downgrade propagates to everything downstream in one place: `Recompute` never
sees a PASSED `ID_NUMBER` (no tier elevation), and ADR-PR722's `IdentitySink`
never fires (it keys on `stored.Status == PASSED`). One gate closes both holes.

**3. Outcomes.**
- **Match →** PASS stands.
- **Mismatch →** FAIL. `Check.Reason` reveals **only the masked last-4** of the
  record phone (e.g. `•••••••1618`) so a legitimate user recognizes which of
  their numbers the ID is registered to, then retries. The reason is the only
  member-visible field carrying this; the handler already scrubs
  `ExtractedFields` from the response.
- **Indeterminate** (no verified account phone, or a phone-bearing ID record with
  no phone) **→** FAIL (hard block) with an actionable reason. The user cannot
  advance to the next tier until a successful match.

**4. Scope.** Phone-bearing ID types (`nin`/`bvn`/`vnin`) are gated. Phone-less
types (`passport`/`drivers_license`/`pvc`) carry no phone to match and are
**exempt** — they pass through unchanged rather than being blocked by a check the
provider record cannot satisfy. (Consequence: while the flag is on, NG Tier-1 is
effectively NIN/BVN, which matches current product intent.)

**5. Fail-closed.** Every indeterminate path blocks, never passes: a nil phone
source with the flag on, a DB read error (surfaced, no PASS written), a missing
profile row, and empty record fields all resolve to a block. The phone source is
wired whenever the flag is on so a nil source cannot occur in practice.

**6. Decoupling.** The account phone is read through a narrow
`AccountPhoneSource` port (mirrors `TierElevator`/`IdentitySink`), satisfied by a
thin `user_profiles` adapter in `finance_routes.go`. All decision logic
(`applyOwnershipGate`, `maskPhone`, `extractRecordPhones`, `isPhoneBearingIDType`)
is pure and unit-tested.

## Consequences

- Closes the "any valid NIN → Tier 1" gap and, together with ADR-PR722,
  closes the NIN→identity oracle at the root: a mismatched/unproven ID never
  passes, so name/DOB are never persisted for it.
- **Accepted residual — masked last-4 hint.** Showing `•••••••1618` on a mismatch
  is a deliberate product decision (memory-jog for legitimate users with multiple
  numbers). It introduces a smaller disclosure: an authenticated caller who
  submits a real-but-not-theirs NIN learns (a) the ID is valid and (b) the last 4
  digits of its registered phone. This is far less than the full name/DOB the
  gate prevents from leaking, and it requires an authenticated account + KYC
  session + recorded consent. If the last-4 signal is later judged too strong,
  the mismatch and no-account-phone cases can be collapsed to one generic reason
  with no code-shape change. A security review of the diff returned no finding at
  confidence ≥ 8.
- Depends on the account having a **verified phone**. Accounts without one
  (see the historical `user_profiles.phone` backfill gap) are hard-blocked until
  they verify a phone — intended under this flag.
- **No new flag coupling beyond KYC verify:** the gate only runs inside the KYC
  gateway; enabling it without `FEATURE_KYC_VERIFY_ENABLED` is flagged at boot as
  a no-op misconfig.
- No migration (columns exist). No money path (profile/tier only — no ledger,
  balances, or kobo arithmetic).

## Rollout

Default off. Enable `FEATURE_KYC_OWNERSHIP_GATE=true` in staging/production only
where `FEATURE_KYC_VERIFY_ENABLED=true` and live Dojah credentials are present
(sandbox test NINs carry canned phones that will not match a real account, so the
gate is exercised by unit tests, not the sandbox).
