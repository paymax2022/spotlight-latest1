# Crypto trading — compliance sign-off record

**Status: NOT SIGNED. Production enablement of crypto trading remains blocked.**

`CRYPTO_TRADING_ENABLED` and `FEATURE_CRYPTO_ENABLED` stay `false` in production until the
sign-off block at the bottom is completed by a named, accountable person.

## Why this file exists and is unsigned

A compliance sign-off is an attestation by an accountable human (counsel, compliance officer, or the
licensed party) that the product's structure is lawful in the markets it serves. It cannot be given
by an engineering assistant: there is no authority behind it, and a record that says "signed" when no
accountable person has signed would be false and would defeat the control. This file records the
owner's stated position and the questions that sign-off has to answer, and leaves the signature to a
person.

## Stated by the owner (recorded, not verified)

- "Quidax legal cover is being used." (2026-10-12)
- Custody: one Quidax sub-account per user is accepted by compliance. (2026-10-11)
- NGN funding: per-user virtual account; the user bears settlement risk (Quidax charge plus platform
  commission). (2026-10-11)

These are decisions about design. None of them is, by itself, written confirmation that the
arrangement is permitted for Spotlight's own role.

## What the sign-off must answer

Questions for counsel/compliance — not conclusions. Cite the instrument and the date relied on.

1. **Whose licence covers what.** Does Quidax's licensing cover the activity Spotlight performs
   (presenting prices, taking a commission or markup, onboarding users to Quidax sub-accounts,
   instructing swaps and withdrawals on their behalf), or does Spotlight need its own registration or an
   agency/introducing arrangement? Is there a written agreement that says so?
2. **SEC (Nigeria) digital-asset rules** as currently in force: registration category, client-money and
   custody expectations, disclosure and suitability requirements, marketing restrictions.
3. **CBN position**: permissibility of NGN settlement through per-user virtual accounts, and of any
   bank/PSP involvement in the NGN leg.
4. **NDPA**: lawful basis, a data-protection impact assessment, the cross-border transfer of user data to
   Quidax, retention, and the data-subject rights process.
5. **AML/CFT**: KYC tier mapping for trading and withdrawal, sanctions and PEP screening, transaction
   monitoring and reporting duties, and travel-rule handling for withdrawals.
6. **Consumer protection**: risk disclosures, the "no guaranteed returns" rule, complaints and dispute
   handling for stuck trades, and fee transparency.
7. **Scope**: assets, per-tier limits, regions and any user groups excluded at launch.

## Technical preconditions (state of the code)

Done: money and rounding package, provider abstraction with webhook signature verification, swap state
machine, fail-closed error taxonomy. **Not done** and blocking regardless of sign-off: real asset-backed
trading and deposit crediting, provider-driven withdrawal confirmation, three-way reconciliation, the
Quidax sandbox checklist (event names, webhook timestamp unit, reference idempotency), and the admin
approvals and risk queues. See `docs/crypto/DISCOVERY.md` and the audit findings.

## Sign-off (to be completed by a person)

| Field | Entry |
|---|---|
| Name | |
| Role / firm | |
| Date | |
| Scope approved (assets, limits, regions) | |
| Conditions attached | |
| Evidence (opinion letter, agreement, regulator correspondence) | |
| Review date | |

Enablement checklist once signed: record the evidence above, set the production flags, run the staged
rollout (internal, 1%, 10%, 100%), and keep the kill switch documented in the runbook.
