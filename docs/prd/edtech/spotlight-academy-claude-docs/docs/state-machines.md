# State Machines

All lifecycles below are guarded: only listed transitions are legal; illegal ones are rejected
and audit-logged. Guards are business preconditions checked before the transition commits.

## 1. Learner progression (per LearningObjective)

States: `not_started → in_progress → practiced → mastered → exam_ready`

| From | Event | To | Guards / effects |
|---|---|---|---|
| not_started | open_lesson | in_progress | — |
| in_progress | complete_practice | practiced | min practice attempts met |
| practiced | pass_mastery_check | mastered | score ≥ threshold → emit ProgressEvent(mastered); unlock next; reward-eligibility check |
| mastered | exam_align | exam_ready | objective tagged to a target exam |
| any | remediate | in_progress | only regression path; triggered by failed re-check |

## 2. Exam attempt (CBT)

States: `created → started → (paused) → submitted → scored → reviewed`

| From | Event | To | Guards / effects |
|---|---|---|---|
| created | begin | started | entitlement valid; server timer starts (authoritative) |
| started | pause/offline | paused | allowed only if blueprint permits; timer policy enforced |
| paused | resume | started | within allowed window |
| started/paused | submit | submitted | **idempotent**; freeze responses (immutable) |
| submitted | score | scored | apply scoringRules; compute readiness/predicted |
| scored | review | reviewed | render breakdown; emit analytics; integrity signals logged |

Timing is server-authoritative; offline attempts reconcile against server clock on sync.

## 3. Reward issuance (learn-to-earn)

States: `triggered → eligibility_checked → credited | rejected`

| From | Event | To | Guards / effects |
|---|---|---|---|
| triggered | evaluate | eligibility_checked | source = mastery/streak/challenge |
| eligibility_checked | approve | credited | **funded pool** + per-user/campaign caps + anti-fraud pass → **idempotent ledger credit** + notify |
| eligibility_checked | deny | rejected | pool exhausted / cap hit / fraud signal → log reason |

No credit is ever written without a funded `RewardPool`.

## 4. Purchase / BNPL → entitlement

States: `cart → checkout → paid | bnpl_active → entitled → (refunded)`

| From | Event | To | Guards / effects |
|---|---|---|---|
| cart | checkout | checkout | price locked |
| checkout | pay_now | paid | wallet/gateway charge (idempotent) |
| checkout | start_bnpl | bnpl_active | BNPL eligibility + schedule (rail) |
| paid/bnpl_active | grant | entitled | entitlement state flips; access unlocked |
| entitled | refund | refunded | reverse entitlement + compensating ledger entry |

## 5. EduPay / disbursement

States: `fee_due → funding → collected → disbursed → reconciled`

| From | Event | To | Guards / effects |
|---|---|---|---|
| fee_due | pay/pot_fund | funding | full, BNPL, or save-for-school pot |
| funding | collect | collected | funds in virtual account (rail) |
| collected | disburse | disbursed | to school virtual account (idempotent) |
| disbursed | reconcile | reconciled | match + close; audit |

Scholarship/grant disbursements run the same machine with sponsor funding.

## 6. Credential & earning bridge

States: `pending → issued → (revoked)` then eligibility evaluation

| From | Event | To | Guards / effects |
|---|---|---|---|
| pending | pass_assessment | issued | sign credential; register verificationId |
| issued | revoke | revoked | reason logged; verification updated |
| issued | evaluate_bridge | (no state change) | compute `EarningOpportunity` eligibility → surface unlocked Paymax roles; apply → routes into Paymax role-upgrade/KYC |

## 7. Content publish (Lesson / ContentBundle)

States: `draft → review → approved → live → archived`

Transitions require the appropriate staff capability (content/curriculum); each is audited.
`live → archived` retains immutable history; offline bundles re-package on `approved→live`.
