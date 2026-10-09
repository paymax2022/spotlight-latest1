# ADR-PR568: Mirror provider-held policies in a separate table, not into `insurance_policy`

## Status
Accepted (implemented in PR #568).

## Context
Policies bought directly at MyCover did not appear on the admin insurance dashboard. The
dashboard counts `insurance_policy`, and only our own bind path creates rows there. MyCover's
`GET /v2/policies` lists every policy on our distributor account (10 when checked), so the data
to show them exists.

The obvious fix is to import those policies into `insurance_policy`. That is wrong here:

- `insurance_policy.policyholder_user_id` is `NOT NULL REFERENCES auth.users`. A policy bought at
  the provider has no Paymax user.
- The dashboard's gross premium and commission figures are computed from `insurance_policy`.
  Importing would add premium that never passed through our ledger, so the figures would no longer
  reconcile with the ledger and the revenue KPIs would be overstated.
- The bind saga, state machine and claims all assume a Paymax-owned row with a premium transaction
  behind it.

## Decision
Add a read-only mirror, `insurance_provider_policy`, filled by an admin-triggered sync, and show it
in its own dashboard panel beside the book.

- Keyed on `(provider, provider_policy_ref)`; the sync is an idempotent upsert.
- "In Paymax" is computed at read time by joining `insurance_policy` on the same key, so a policy
  bought through the app is recognised without any write to the book.
- Stores no personal data. The provider's list rows carry the holder's name, email, phone and date
  of birth; the adapter's summary type has no field for them, and a test enforces that.
- Moves no money: no ledger entry, wallet, balance or provider call that creates anything.
- Ships dark behind `FEATURE_INSURANCE_PROVIDER_IMPORT_ENABLED`.

## Consequences
- The mirror is only as fresh as the last sync. MyCover has never delivered a webhook to us, so
  there is no push; a scheduled sync is a follow-up.
- Premium shown for provider-only policies is explicitly labelled as not revenue.
- If the business later wants provider-bought policies in the book (for example, to pay commission
  on them), that needs its own decision: a policyholder model for non-members and a ledger story for
  money that did not move through us.
