# Architecture

The non-negotiable principles. If a change conflicts with one of these, stop and reconsider.

## 1. Single-identity, multi-capability

- One Paymax identity per human. Roles (`learner`, `parent`, `tutor`, `staff`) are **additive
  capabilities** on that identity, not separate accounts.
- A user may hold several roles (a parent who also learns; a tutor who is also a parent).
- Capability unlock is **guarded**: KYC tier + (for minors) guardian consent. Never bypass.
- Minors: every minor identity is linked to a guardian via `GuardianLink`; consent is recorded
  immutably and is a precondition for purchases, community, and data sharing.

## 2. Append-only ledger

- All value movement (reward credits, point conversions, redemptions, charges, refunds, fee
  collections, disbursements) is recorded as **immutable `RewardLedgerEntry` / wallet ledger
  entries**. Balances are **derived**, never edited.
- Corrections happen by posting a compensating entry, never by mutating history.
- Reuses the existing Paymax wallet ledger — see `paymax-rails.md`.

## 3. Guarded state machines

Every lifecycle is an explicit machine with a fixed set of states and **only** declared
transitions. Illegal transitions are rejected and audit-logged. Definitions in
`state-machines.md`. The machines: learner progression, exam attempt, reward issuance,
purchase/BNPL, EduPay/disbursement, credential lifecycle.

## 4. Idempotency

- Every money/reward mutation accepts an **idempotency key**; replays return the original result
  without double-effect.
- Keys are persisted with the resulting entry id. See `conventions.md` for the pattern.

## 5. Provider-agnostic gateways

- Payments, SMS, push, streaming (LiveKit), and content CDN are accessed through **interfaces**.
- Domain logic never imports a vendor SDK directly. Swapping a provider is a config + adapter change.

## 6. Immutable audit trails

- Every **staff action** (content publish, reward-pool change, refund, impersonation, config edit)
  and every **money movement** writes an `AuditLog` entry: actor, action, target, before/after, ts.
- Audit is append-only and queryable in the admin console.

## 7. Offline-first & low-data

- The learner client is **offline-capable**: downloadable `ContentBundle`s; lesson playback,
  practice, and CBT mocks run without connectivity.
- Progress, attempts, and reward-eligible events are **queued locally** and reconciled on
  reconnect with deterministic conflict resolution (server-authoritative for scoring/timing;
  last-writer-wins only for non-critical UI state).
- Low-data: adaptive bitrate, audio-only/transcript fallbacks, compressed asset variants,
  explicit per-bundle data budgets.

## 8. Boundaries — build vs reuse

| Build new (this module owns) | Reuse (Paymax owns) |
|---|---|
| Learning engine: content, adaptivity, progression | Identity / KYC / SSO |
| Gamification engine | Wallet & ledger |
| Exam-arena CBT simulator | BNPL |
| Credentialing & verification | Virtual accounts / bill-pay / payouts |
| Curriculum versioning model | Agent network |
| EdTech-specific admin console | Loyalty, creator monetisation, LiveKit, MapService |

**Rule:** if it moves money or proves identity, it's almost certainly a rail — integrate, don't rebuild.

## Module decomposition (suggested services)

- `identity-bridge` — wraps Paymax identity/KYC + guardian consent for EdTech roles.
- `curriculum` — versioned curriculum/subjects/trades/topics/objectives.
- `content` — lessons, media, bundles, publish workflow, offline packaging.
- `assessment` — question bank, attempts, scoring, item analysis.
- `exam-arena` — arenas, CBT blueprints, mocks, readiness.
- `progression` — mastery, paths, recommendations.
- `gamification` — XP/streaks/badges/challenges/leaderboards.
- `rewards` — pools, eligibility, ledger credits, redemptions (on wallet rail).
- `commerce` — plans, entitlements, bundles, access cards (on payments/BNPL rails).
- `edupay` — fee schedules, pots, disbursements, scholarships (on virtual-account rail).
- `credentials` — issuance, verification registry, earning-bridge eligibility.
- `live` — sessions on LiveKit rail.
- `sponsors` — campaigns, funded pools, reporting.
- `schools` — B2B2C institutions, licences, enrolment (Phase 4).
- `notifications`, `moderation`, `support`, `analytics`, `admin-bff`.
