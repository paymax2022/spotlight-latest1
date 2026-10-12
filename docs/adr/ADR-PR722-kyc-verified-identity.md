# ADR-PR722: Source KYC name/DOB from the provider, persist first-write-wins

- **Status:** Accepted
- **Date:** 2026-10-12
- **Module:** kyc / kycverify (identity path)

## Context

The KYC step-up form (`app/kyc-verify/id-number.tsx`) asked the user to type
their first name, last name and date of birth alongside the NIN/BVN. Those
values were never used: the Dojah ID-number data-match (`VerifyIDNumber`) keys
off the ID number alone and returns the authoritative legal name + DOB. The
typed values were collected, sent, and silently dropped — redundant, and a
typo could diverge from the verified record.

Separately, a "test NIN fails" report turned out to be configuration, not code:
the four historical Dojah failure modes are already fixed in-tree, and the
remaining failure is `FEATURE_KYC_VERIFY_ENABLED` being off and/or missing
Dojah sandbox credentials. No code change makes an unconfigured provider pass.

## Decision

**1. Stop collecting name/DOB from the user.** The `kyc-verify` form drops the
First/Last name and DOB inputs; the `/checks/id-number` request carries only the
session id and ID number (pure, unit-tested `idNumberRequestBody`).

**2. Persist the provider-verified identity.** On a PASSED `ID_NUMBER` check the
kycverify gateway persists the provider-returned full name + DOB onto
`user_profiles` (columns already exist — additive, no migration), via a new
narrow `IdentitySink` port (mirrors `TierElevator`, keeps kycverify decoupled
from the kyc package). A pure `ExtractVerifiedIdentity` normalizes the name and
the DOB to ISO `YYYY-MM-DD` (ISO and day-first layouts; an ambiguous/unparseable
date is dropped, never stored raw). The write is best-effort and non-fatal — a
storage hiccup must not fail an otherwise-successful verification. Extracted PII
stays withheld from the member check response (unchanged no-oracle rule) and is
never logged.

**3. First-write-wins, deliberately.** `kyc.Service.SaveVerifiedIdentity` sets
`first_name`/`last_name`/`full_name`/`date_of_birth` ONLY when the profile field
is currently blank. The flow does not (and, post-form-change, cannot) prove the
submitted NIN belongs to the caller, so an unconstrained overwrite would let an
attacker swap a victim's provider-returned name onto their own readable profile
and read it back — a NIN→identity oracle. First-write-wins makes a populated
profile immutable here, removing the repeatable-overwrite oracle while
preserving the legitimate case (a new user verifying their own ID fills their
empty profile).

## Consequences

- The verified legal name/DOB lands on the profile for the common case
  (new/empty profile), sourced from the provider, never user-typed.
- **Residual risk:** a fresh/empty-profile account can still resolve one
  NIN→name per billable live provider call. This sits on top of a pre-existing
  "any NIN → Tier 1" gap (the flow never binds the NIN to the account). Both are
  closed at the root by a follow-up **NIN-ownership gate** (e.g. matching the
  NIN's registered phone against the account's verified phone), tracked
  separately.
- Rides the existing `FEATURE_KYC_VERIFY_ENABLED` flag; the sink is only wired
  when the gateway is, and a nil sink is a safe no-op. No new flag, no migration.
- No money path: no ledger entries, balances, or kobo arithmetic — a
  profile-column UPDATE only.
