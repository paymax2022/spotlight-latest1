# Gamification & Learn-to-Earn

Two layers: **gamification** (engagement mechanics) and **rewards** (real value, sponsor-funded).
Keep them separable — gamification can run without payouts; rewards never run without a funded pool.

## Gamification engine
- **XP** on meaningful actions (lesson complete, mastery pass, mock attempt). Curves configurable.
- **Levels** unlock cosmetic/feature perks (no pay-to-win on learning outcomes).
- **Streaks** with freeze tokens; daily-goal driven (L2).
- **Badges** with explicit criteria; **Challenges/Quests** (daily/weekly + sponsor-branded).
- **Leaderboards** scoped class/school/national/friends with reset policies; anti-cheat thresholds.
- All configurable from the admin gamification module — no code deploy to tune.

## Learn-to-earn rewards (the differentiator)
**Golden rule:** no reward credited without a **funded `RewardPool`**. See `state-machines.md#3`.

Flow: `trigger → eligibility_checked → credited|rejected`
- Triggers: mastery, streak milestone, challenge completion.
- Eligibility guards: pool balance (atomic check), per-user + per-campaign caps, **anti-fraud**
  (velocity, device, attempt-quality — a low-effort attempt must not earn).
- Credit = **idempotent, append-only ledger entry** (on the Paymax wallet ledger).
- Redemption (G7): points → wallet credit / airtime / data / vouchers, via `RedemptionCatalogItem`.

## Funding model
- Pools are funded by **sponsors / CSR / DFI campaigns** (admin sponsor module).
- Each pool reports spend to its sponsor. This keeps learner rewards **off the P&L** and scalable.

## The earning bridge (where learning becomes income)
- Trade credentials (S4→S5) compute eligibility against `EarningOpportunity` rules.
- Unlocked Paymax roles (driver, agent, creator, merchant, service provider) surface in S6.
- Apply (S7) routes into the **existing Paymax role-upgrade/KYC onboarding** — do not rebuild it.
- This closes the loop: *learn → practise → earn → graduate*, and is the moat no academic-only
  competitor can copy.

## Anti-abuse checklist (enforce before any credit)
- [ ] Pool funded and within cap.
- [ ] Per-user cap not exceeded.
- [ ] Attempt-quality / fraud signals pass.
- [ ] Idempotency key fresh.
- [ ] Ledger entry written; user notified.
