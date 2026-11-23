# Standard: every admin decision appears in Operations → Needs attention

**Status: binding on every module.** The admin dashboard's *Needs attention*
section is the platform's single work queue. If a human admin has to decide
something and it is not in there, the dashboard is reporting an all-clear the
platform never earned.

## The rule

> Anything that requires an admin approval, verification, rejection, publish,
> settlement or moderation decision **must** be a row in `overviewSpecs` in
> [`backend/internal/handlers/admin_overview.go`](../../backend/internal/handlers/admin_overview.go),
> which `GET /api/v1/admin/overview` serves and
> [`AdminDashboard.tsx`](../../frontend-admin/src/features/dashboard/AdminDashboard.tsx)
> renders. Nothing else may create a queue, and the dashboard may not add one of
> its own.

**IN** — a state machine is holding an item until an admin acts on it.
**OUT** — states waiting on the *end user* (`needs_more_info`,
`correction_requested`, `clean_version_requested`, `CHANGES_REQUESTED`), drafts
never submitted, and pure volume metrics.

A queue whose screen does not exist yet is still registered, with `AttnNote`
instead of `AttnHref`. Hiding it is how "not reported" becomes "assumed clear".

## Why the rule exists

The Programs group used to be the visible symptom. The dashboard appended its own
rows for contestants, Open Mic, auditions, Academy and Film Academy with
`attention: { value: 0 }` **written by hand** — a number nobody had read. The
filter that hoists work is `value > 0`, so those queues could never surface:
songs handed in for review, contest applications awaiting approval, audition
registrations and results waiting on a second admin all reported "cleared"
forever, while the page claimed to answer *what needs me today?*

Two principles make the dashboard trustworthy, and both are enforced by tests:

1. **UNKNOWN IS NOT ZERO.** A count that could not be read is `null`, rendered
   "—", and named in *Data status*. It is never rendered 0.
2. **THE REGISTRY OWNS THE QUEUE LIST.** Attention values come from the backend
   or not at all. Volume may be summarised client-side; queue counts may not.

## Adding a queue (checklist)

1. Find the state the review screen acts on, and take the literal from the
   table's own `CHECK` constraint or enum — do not assume `status='pending'`.
   The spellings differ per module (`'PENDING'`, `'submitted'`, `'queued'`,
   `'REQUESTED'` on a column called `state`, `'FNOL_SUBMITTED'`).
2. Add the row: `Key, Label, Group, Href, Volume/VolSQL, Attn/AttnSQL,
   AttnHref` **xor** `AttnNote`, `Severity`.
   `Group` must be one the dashboard orders: Money, Commerce, Travel, Health,
   Community, Programs.
3. Prefer a **blacklist** (`status NOT IN (...)`) when the status column is free
   text, so a status added later still counts as work. Prefer a **whitelist**
   (`status='pending'`) when an enum or CHECK closes the vocabulary.
4. Link to the page where the decision is *made*, not the module's front door.
5. Add the key to the ledger below, and pin it in
   `TestOverviewSpecs_DecisionQueuesAreRegistered`
   ([`admin_overview_test.go`](../../backend/internal/handlers/admin_overview_test.go)).
6. Verify — the structure and link tests run everywhere; the predicate tests need
   the live DB:

```bash
cd backend
go test ./internal/handlers -run 'TestOverviewSpecs|TestAdminOverview'                     # structure + links + doc ledger
TEST_DATABASE_URL="$DATABASE_URL" go test ./internal/handlers -run 'TestOverviewSpecs' -v   # predicates vs real CHECKs/enums
```

A reviewer who skips step 5 should reject the change: the doc test fails, which is
the point.

## Known queues with no working screen

| key | why there is no link |
| --- | --- |
| `auditions` | no console page reads `audition_registrations` (enum `registration_status`: pending / confirmed / cancelled / attended). Build the screen, then swap `AttnNote` for `AttnHref`. |
| `stays-kyb` | the stays KYB page is not connected to the API. |
| `kyc-verify` | automated by design — reported for volume, no human review surface. |

## The ledger

Every row below is a registry entry and must appear in this file;
`TestOverviewSpecs_AreLedgedInTheStandardDoc` fails CI if the two drift apart.
"Screen" is where an admin resolves the queue; "critical" means money,
compliance or a published result is blocked until it is done.

| key | module | group | what is awaited | screen | severity |
| --- | --- | --- | --- | --- | --- |
| `kyc-verify` | Identity verification | Money | Needs a human review | no screen — Verification is fully automated — no admin review surface (ADR-PR808) | critical |
| `fx-kyc` | FX KYC | Money | Awaiting review | /admin/fx/kyc | critical |
| `trading-kyc` | Trading KYC | Money | Awaiting review | /admin/trading/kyc | critical |
| `adjustments` | Wallet adjustments | Money | Awaiting a second approver | /admin/payments-finance/adjustments | critical |
| `crowdfunding` | Crowdfunding | Money | Withdrawals pending | /admin/crowdfunding/withdrawals | critical |
| `cf-review` | Campaign review | Money | Awaiting review | /admin/crowdfunding/review | warn |
| `cf-featured` | Featured requests | Money | Awaiting a decision | /admin/crowdfunding/featured | warn |
| `cf-refunds` | Crowdfunding refunds | Money | Refund requests | /admin/crowdfunding/finance | critical |
| `cf-fraud` | Crowdfunding fraud | Money | Alerts to investigate | /admin/crowdfunding/fraud | critical |
| `cf-compliance` | Data-subject requests | Money | Requests to fulfil | /admin/crowdfunding/compliance | critical |
| `crypto` | Crypto | Money | Awaiting AML review | /admin/crypto/withdrawals | critical |
| `referral` | Referrals | Money | Payouts queued | /admin/referral-rewards | critical |
| `referral-ambassadors` | Referral ambassadors | Money | Applications | /admin/referral/ambassadors/queue | warn |
| `referral-aml` | Referral AML flags | Money | Flags to review | /admin/referral/compliance | critical |
| `payouts` | Platform payouts | Money | Pending release | /admin/payments-finance | critical |
| `escrow` | Social escrow | Money | Disputes open | /admin/social-escrow/disputes | critical |
| `disputes` | Disputes desk | Money | Open, unassigned | /admin/finance/disputes | critical |
| `insurance` | Insurance claims | Money | Claims to assess | /admin/insurance/claims | critical |
| `restaurant-kyb` | Restaurant business verification | Commerce | Submitted, awaiting verification | /admin/restaurant/onboarding | critical |
| `merchant-onboarding` | Merchant onboarding | Commerce | Applications to review | /admin/merchant-onboarding | critical |
| `business` | Business registry | Commerce | Verifications awaiting review | /admin/business | critical |
| `restaurant` | Restaurant | Commerce | Withdrawals to settle | /admin/restaurant/withdrawals | critical |
| `restaurant-listings` | Restaurant listings | Commerce | Listings awaiting review | /admin/restaurant/moderation | warn |
| `marketplace` | Marketplace | Commerce | Awaiting moderation | /admin/marketplace/moderation | warn |
| `mkt-verification` | Marketplace seller verification | Commerce | Verification requests | /admin/marketplace/users | critical |
| `mkt-appeals` | Marketplace appeals | Commerce | Appeals to decide | /admin/marketplace/appeals | critical |
| `mkt-flags` | Marketplace flags | Commerce | Open flags | /admin/marketplace/flags | warn |
| `featured-placement` | Featured placement | Commerce | Campaigns under review | /admin/featured-placement | warn |
| `realtor` | Realtor listings | Commerce | Awaiting verification | /admin/realtor/moderation | warn |
| `property-roles` | Property role verification | Commerce | Awaiting verification | /admin/property-roles | warn |
| `stays` | Stays | Travel | Properties to review | /admin/stays/moderation | warn |
| `stays-kyb` | Stays hotelier business verification | Travel | Submitted, awaiting verification | /admin/stays/kyc | critical |
| `mobility-drivers` | Mobility driver verification | Travel | Awaiting verification | /admin/mobility/drivers | critical |
| `bus-operators` | Bus operator verification | Travel | Operators pending | /admin/mobility/bus | warn |
| `health` | Health providers | Health | Applications to review | no screen — No review screen yet — applications are decided over the API only | warn |
| `doctor-verification` | Doctor verification (MDCN) | Health | Awaiting verification | /admin/health/doctor/verification | critical |
| `vet-credentials` | Vet credential verification | Health | Awaiting verification | /admin/health/vet/verification | critical |
| `telemedicine` | Telemedicine payouts | Health | Pending | /admin/telemedicine/dashboard | critical |
| `creators` | Creators | Community | Payout requests | /admin/creators/payouts | critical |
| `events` | Events | Community | Events awaiting approval | /admin/events/approval | warn |
| `registration` | Registrations | Programs | Awaiting review | /admin/registration | warn |
| `stem-schools` | STEM school verification | Programs | Awaiting verification | /admin/schools | warn |
| `stem-submissions` | STEM submissions | Programs | Awaiting review | /admin/stem/submissions | warn |
| `sme-pitch` | SME pitch applications | Programs | Awaiting review | /admin/sme-pitch | warn |
| `academy-tutors` | Academy tutors | Programs | Awaiting verification | /admin/academy/tutors | warn |
| `academy-questions` | Academy question bank | Programs | Awaiting review | /admin/academy/question-bank | warn |
| `open-mic-submissions` | Open Mic songs | Programs | Awaiting a decision | /admin/open-mic | warn |
| `open-mic-applications` | Open Mic applications | Programs | Applications to review | /admin/open-mic | warn |
| `academy-applications` | Academy applications | Programs | Awaiting review | /admin/academy/film | warn |
| `auditions` | Audition registrations | Programs | Registrations awaiting confirmation | no screen — No review screen yet — the console has no page that reads audition_registrations, so these cannot be actioned from the dashboard | warn |
| `contest-approvals` | Contest decision approvals | Programs | Awaiting a second admin | /admin/voting/approvals | critical |
