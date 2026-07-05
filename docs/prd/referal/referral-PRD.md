# Product Requirements Document (PRD)
## Spotlight / Paymax — Referral Earning Management System (Super-App Module)

| | |
|---|---|
| **Product** | Referral Earning Management System — a programmable growth engine inside the Spotlight/Paymax super-app |
| **Surfaces** | Consumer **Mobile App** (iOS/Android) + Operator **Web Admin Console** |
| **Version** | 1.1 (Draft for review) |
| **Status** | Draft |
| **Owner** | Growth / Product — Spotlight/Paymax |
| **Last updated** | 2026-06-25 |
| **Changelog** | v1.1 — added **Attribution & Default-Referrer Policy** (§7A): organic/no-code signups default to a house/super-admin account, plus related scope (late code-claim grace window, fallback-referrer chain, invalid/self-referral handling, reassignment & disputes, organic-vs-referred segmentation). New screens M-ONB-10, M-INV-10, A-SADM-07, A-USR-05, A-USR-06, A-BI-08. |

> **Reading note:** Every screen has a stable ID (`M-…` mobile, `A-…` admin) — use these in Figma, Jira and acceptance criteria. Sections 1–7 are the spec; **Section 8 is the exhaustive screen inventory.** Two themes are load-bearing and appear in the screens themselves, not just in policy: **(1) the pyramid-scheme line** — every naira earned ties to genuine product usage/revenue, never recruitment — and **(2) fraud control** via existing KYC (BVN/NIN) dedup, vesting/holdbacks, and clawbacks.

---

## 1. Summary & Strategic Thesis

Spotlight/Paymax already own the assets a referral *earning* system needs: a single KYC'd identity (BVN/NIN), a wallet for instant payout, an agent network for offline reach, and a growing set of verticals (property + mini-apps) that generate the real revenue used to **fund and justify** rewards. This module turns those into a **programmable growth engine** — not a single "invite a friend" button.

**Three commitments that shape every screen:**
1. **Referral is a growth OS.** One event-driven engine; every vertical and mini-app fires referable events and funds rewards through it. The property module, bills, savings, and future mini-apps all plug into the same ledger.
2. **The pyramid line is a design centre, not a footnote.** The closest local benchmark — **PalmPay's PalmForce** — pays a per-invite bounty *plus* multi-tier "downline" earnings on transactions. That model is powerful but sits on the edge of regulatory exposure. Our earning model ties **all** earnings (including agent/team overrides) to the **verified activity/revenue** of referred users, with tier caps and disclosures — never to recruitment alone.
3. **Fraud control is the moat.** Standalone referral tools can't enforce one-human-one-earning-identity. We can, via KYC dedup, plus device fingerprinting, velocity checks, reward **vesting/holdbacks**, and a real-time **clawback** engine. This is the difference between viral growth and a reward-budget bleed.

**Why us, not PalmForce?** KYC-backed anti-fraud, LTV-priced rewards, instant wallet payout, and cross-vertical reach — capabilities a bolt-on referral program cannot match.

---

## 2. Goals & Success Metrics

| Goal | Primary metric | Target signal |
|---|---|---|
| Drive viral, low-cost acquisition | **K-factor (viral coefficient)**; referral share of new users | Referral CAC < paid CAC |
| Acquire *valuable* users, not vanity signups | Referred-user activation & 30/60/90-day retention | Activated-referral rate ↑ |
| Protect margin | **Reward-to-LTV ratio**; reward budget burn | Reward ≤ target % of referred LTV |
| Crush fraud | Fraud rate; ₦ fraud prevented; clawback recovery | Fraud loss below threshold |
| Deepen the super-app | Cross-vertical referrals; referred-user products adopted | ≥ 2 products per referred user |
| Monetise the rails | Merchant-funded campaign GMV; platform take | Referral-as-a-platform revenue |

**Funnel instrumented end-to-end:** invite → click → signup → KYC → qualifying action → activated → retained → reward paid.

**Non-goals (v1):** a recruitment-driven MLM; a standalone non-super-app product; rebuilding auth/KYC/wallet; uncapped multi-tier overrides.

---

## 3. Personas & Roles (RBAC)

One identity holds one or more **contextual roles**, scoped by campaign / network / org. A single human can be a referrer, an ambassador, a team agent, *and* a merchant.

| Role | Surface(s) | Core jobs |
|---|---|---|
| **Referrer** (default, every user) | Mobile | Generate link/code, share, track, earn, withdraw |
| **Ambassador / Creator** | Mobile (+ admin-lite) | Power referrer: vanity codes, creative tools, advanced stats, higher tier |
| **Agent / Aggregator** (team leader) | Mobile + Admin | Manage a network; earn **overrides tied to verified network activity/revenue** |
| **Merchant / Partner** | Admin (+ mobile-lite) | Run and **fund** own campaigns on the rails (referral-as-a-platform) |
| **Campaign Manager** | Admin | Design, target, fund, A/B test, throttle campaigns across verticals |
| **Finance / Payouts Admin** | Admin | Approve payouts, reconcile, set budgets, monitor burn, settle merchants |
| **Risk / Fraud Analyst** | Admin | Rules, alerts, investigations, clawbacks, blocklists, link analysis |
| **Compliance Officer** | Admin | Pyramid-line policy, tier caps, disclosures, AML, regulatory reporting |
| **Platform Super Admin** | Admin | Global config, RBAC, integrations, kill-switches |
| **Growth / Analytics** | Admin | Funnels, K-factor, cohort LTV, experiments |

Cross-cutting: **least-privilege**, **full audit logging** on every reward / clawback / payout / config change, **role context switcher**, and **step-up verification** when a user becomes an ambassador, agent or merchant.

---

## 4. Scope & Phasing

- **Phase 1 — Compliant core.** Two-sided referral (link/code/QR + share-by-name), KYC dedup, wallet payout, a single/limited compliant tier, reward vesting baseline, fraud baseline (device + velocity + clawback), core campaign + finance + risk consoles.
- **Phase 2 — Earning economy.** Ambassador & agent/team zones with **activity-based** overrides, gamification (ranks, leaderboards, missions), dynamic/LTV-priced rewards, advanced vesting, reward catalog & currencies.
- **Phase 3 — Referral-as-a-platform.** Merchant-funded campaigns + partner API/SDK, cross-vertical orchestration, advanced fraud (identity-graph link analysis), experimentation at scale.

Each screen is tagged **[P1]/[P2]/[P3]**.

---

## 5. Information Architecture

**Mobile app** — a **Referral/Earn hub** reachable from the super-app home, with tabs: **Home (earnings) · Invite · Earnings/Rewards · Missions · Campaigns**, plus context zones that appear by role: **Ambassador Zone**, **Team/Agent Zone**, **Merchant Zone**. Top bar: notifications, role switcher, help.

**Admin console** — left-nav workspaces gated by role: **Overview/Growth · Campaigns · Rewards & Ledger · Finance/Payouts · Risk & Fraud · Compliance · Ambassadors & Agents · Merchants/Partners · Users & Graph · Gamification · Analytics**.

---

## 6. Functional Requirements (condensed; expanded in §8)

- **FR-INVITE:** link/code/QR/deep-link/share-by-name; multi-channel; contextual post-action share; idempotent attribution → `M-INV-*`.
- **FR-ATTRIB:** attribution priority rules, attribution window, **default/fallback referrer (house/super-admin) for no-code signups**, late code-claim grace window, invalid/self-referral handling, reassignment & disputes → `M-ONB-10`, `M-INV-10`, `A-SADM-07`, `A-USR-05/06`. *(see §7A)*
- **FR-EARN:** reward ledger with states (earned → pending → vesting → eligible → paid → clawed-back); withdraw to wallet; currencies; statements → `M-ERN-*`, `A-RWD-*`.
- **FR-GAM:** missions/quests, ranks/tiers, badges, leaderboards, contests → `M-GAM-*`, `A-GAM-*`.
- **FR-CAMP:** campaign builder, reward config (flat/dynamic/LTV), vesting, targeting, A/B, budget/throttle, cross-vertical → `A-CMP-*`, `M-CMP-*`.
- **FR-AMB/AGT:** ambassador tooling; agent network with **activity-based overrides**, caps, disclosures → `M-AMB-*`, `M-AGT-*`, `A-AMB-*`.
- **FR-MERCH:** merchant-funded campaigns, funding, settlement, partner API → `M-MER-*`, `A-MER-*`.
- **FR-RISK:** KYC dedup, device fingerprint, velocity, behavioural cohorts, clawback, blocklists, identity graph → `A-RSK-*`.
- **FR-COMPLY:** pyramid-line/tier-cap policy, disclosures, AML, NDPC consent, jurisdiction toggles → `A-CMPL-*`.
- **FR-FIN:** payouts, reconciliation, budget/burn, reward-to-LTV, merchant settlement → `A-FIN-*`.

---

## 7. Reward & Economic Model (summary)

- **Two-sided** by default (referrer + referred-friend), conditional on a **qualifying action** (KYC + first transaction / N activities), not raw signup.
- **Dynamic / LTV-priced** rewards = f(predicted LTV × verified activity), within finance-set guardrails — out-earns flat-bounty competitors only where it pays back.
- **Vesting / holdback**: rewards release in tranches as the referred user proves value (e.g., on KYC, first txn, retained 30/60/90d) — kills self-referral and incentive-farming economics.
- **Agent/team overrides**: a percentage of the **verified activity/revenue** of network members, **capped**, disclosed, and never paid for recruitment.
- **Currencies**: cash, cashback, airtime/data, points, discounts, lottery entries, charity — instant to wallet.
- **Budget governor**: per-campaign caps, ROI guardrails, auto-pause on fraud/burn spikes, finance approval, kill-switch.

---

## 7A. Attribution & Default-Referrer Policy (house capture)

**The rule (as requested):** when a user signs up **without a valid referral code**, the system must **not lose the referral** — it defaults the **referrer side** to a designated **house / Super-Admin account**, and the referrer-side bonus accrues to that account. No signup goes unattributed.

But "assign it to the super admin" only behaves correctly if a handful of adjacent decisions are designed alongside it. This section specifies the full policy so the rule is safe, fair, and doesn't pollute economics or compliance.

### 7A.1 Default-referrer resolution (fallback chain)
Resolve the referrer in priority order; the **first match wins**, and the **house/Super-Admin account is the ultimate fallback**:

1. **Valid referral code entered** at signup → that referrer.
2. **Deferred deep-link / click attribution** within the attribution window (user tapped a real referral link but didn't type the code) → the original referrer. *(Don't prematurely send these to the house.)*
3. **Context-scoped default** (configurable): signed up via an **agent's QR / estate link / campaign source** but no code → that **agent / estate admin / campaign owner**.
4. **Regional / segment house account** (optional, configurable).
5. **Global house / Super-Admin account** → the default of last resort. **This satisfies the requested rule.**

> **Implementation note:** implement the destination as a dedicated **system/house account** that the Super Admin owns and controls — not an individual employee's personal wallet. Same intent, cleaner accounting, and no individual appears to "personally earn" from organic traffic. The fallback chain is fully configurable; if Spotlight/Paymax want the simplest version, set the chain to **{valid code → deep-link → global house}** and skip the middle tiers.

### 7A.2 What the house does (and does NOT) get
- **Referrer-side bonus → house account.** Yes, per the rule.
- **Referee/welcome side → unaffected.** Whether the *new* organic user gets a welcome reward is a **separate campaign decision** (default: no referee bonus unless a general welcome offer is running). The default-referrer rule never penalises the new user.
- **House accruals are EXCLUDED from agent/ambassador override chains.** A house-captured signup must never roll up as override "earnings" to any human upline — that would manufacture recruitment-style earnings and breach the pyramid-line policy (§7, §10).
- **House accruals are a distinct, non-withdrawable ledger** (a notional internal credit), segmented from real user payouts. Finance decides whether the pool is **(a) budget-neutral** (the company simply doesn't pay a referrer-side bonus on organic signups — recommended default) or **(b) a funded "house pool"** used to bankroll future campaigns/promotions. *This is a finance decision, flagged in §13 — it is internal accounting, not revenue.*

### 7A.3 Late code-claim grace window (fairness + dispute prevention)
A user who forgot to enter a code at signup can **claim a referral code after signup** within a configurable **grace window** (e.g., until KYC / first qualifying action, or N hours) via `M-INV-10`. On a valid claim, attribution **reassigns** from the house to the real referrer and the house accrual is reversed (audited). After the window closes, attribution is **locked**.

### 7A.4 Invalid / self / fraudulent code handling
- **Invalid or expired code** → treat as no-code → fallback chain → house; log the attempt (typo vs abuse signal); offer inline "check code" correction.
- **Self-referral** (own code, or same KYC identity / device) → **blocked**; no referrer-side reward to the user; defaults to house; flagged to Risk (§A-RSK).
- **Suspended / fraudulent referrer's code** → reward withheld/clawed back; attribution routes to house; case opened.

### 7A.5 Reassignment, reversal & audit
All attribution changes (late claim, fraud correction, dispute resolution) run through a single **reassignment tool** (`A-USR-06`) that reverses the prior accrual (incl. house) and re-accrues to the corrected party, with a full immutable audit trail. **Separation of duties:** the Super Admin who owns the house account cannot be the sole approver of reassignments that benefit the house — Risk/Compliance co-sign.

### 7A.6 Analytics integrity (don't fake your virality)
Every house-captured signup is **tagged `attribution=house_default`** and **excluded from K-factor / viral-coefficient / referral-CAC** calculations. Genuine viral growth and house-captured organic are reported as **separate lines** (`A-BI-08`). Otherwise the program will appear more viral than it is and mislead growth decisions.

---

# 8. EXHAUSTIVE SCREEN INVENTORY

Legend — **Roles:** Rf=Referrer, Am=Ambassador, Ag=Agent/team, Me=Merchant, CM=Campaign mgr, Fin=Finance, Rsk=Risk/fraud, Cmp=Compliance, SA=Super admin, Gr=Growth/analytics. **Phase:** P1/P2/P3.

## 8A. MOBILE APP

### Onboarding & Entry — `M-ONB`
| ID | Screen | Roles | Purpose / key elements | Phase |
|---|---|---|---|---|
| M-ONB-01 | Referral hub entry / splash | Rf | Enter Earn hub from super-app home | P1 |
| M-ONB-02 | "How earning works" explainer | Rf | Compliant explainer: earnings tied to friends' real activity | P1 |
| M-ONB-03 | Earnings disclosure & T&Cs | Rf | Fair-earning terms, caps, no-exaggerated-claims, accept | P1 |
| M-ONB-04 | Contacts/notification consent | Rf | NDPC-compliant consent for contact access + nudges | P1 |
| M-ONB-05 | Become Ambassador — intro | Am | Benefits, requirements, tier preview | P2 |
| M-ONB-06 | Become Agent/Team Lead — intro | Ag | Override model explained (activity-based), disclosures | P2 |
| M-ONB-07 | Become Merchant/Partner — intro | Me | Fund-your-own-campaign overview | P3 |
| M-ONB-08 | Step-up verification | Am/Ag/Me | Extra KYC for elevated earning roles | P2 |
| M-ONB-09 | Role/context switcher | Multi | Switch between referrer/ambassador/agent/merchant | P2 |
| M-ONB-10 | Referral code entry (at signup) | Rf | Optional "Have a referral code?" field; inline validate; invalid → "check code"; blank → silently routes to default/house per §7A | P1 |

### Referral Home / Dashboard — `M-HOME`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-HOME-01 | Earn dashboard | Rf | Earnings snapshot, invites, rank, quick-share | P1 |
| M-HOME-02 | My code & link | Rf | Personal code/link, copy, QR | P1 |
| M-HOME-03 | Earnings summary card | Rf | Paid / pending / vesting / clawed-back at a glance | P1 |
| M-HOME-04 | Activity timeline | Rf | Recent signups, activations, rewards | P1 |

### Invite & Share — `M-INV`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-INV-01 | Invite friends (share sheet) | Rf | Multi-channel: WhatsApp, SMS, social, copy | P1 |
| M-INV-02 | Share by name | Rf | Mention-Me-style: friend redeems by referrer's name | P2 |
| M-INV-03 | Contact picker (consented) | Rf | Select contacts to invite (with consent) | P1 |
| M-INV-04 | QR code (in-person/offline) | Rf/Ag | Scan-to-join for offline/agent contexts | P1 |
| M-INV-05 | Custom/vanity link & UTM | Am | Branded codes, source tags | P2 |
| M-INV-06 | Contextual share prompt | Rf | Post-action share (paid bill, won, listed property) | P2 |
| M-INV-07 | Invite tracking | Rf | Per-invitee status: clicked → signed up → activated | P1 |
| M-INV-08 | Nudge a pending invitee | Rf | Reminder to a friend who hasn't activated | P1 |
| M-INV-09 | Vertical referral picker | Rf | Refer to property / bills / savings / mini-apps | P2 |
| M-INV-10 | Claim a referral code (late) | Rf | Enter a forgotten code within the grace window (until KYC/first action); reassigns from house to real referrer; locks after window (§7A.3) | P1 |

### Earnings & Rewards — `M-ERN`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-ERN-01 | Earnings ledger | Rf | Full timeline across all states | P1 |
| M-ERN-02 | Reward detail | Rf | Which referral/action, amount, status | P1 |
| M-ERN-03 | Vesting / holdback tracker | Rf | What unlocks when, conditions remaining | P2 |
| M-ERN-04 | Withdraw to wallet | Rf | Move eligible earnings to wallet, instant | P1 |
| M-ERN-05 | Reward currency selector | Rf | Cash / airtime-data / points / discount / charity | P2 |
| M-ERN-06 | Rewards catalog / redeem | Rf | Redeem points for items | P2 |
| M-ERN-07 | Earnings statement / export | Rf/Am/Ag | Downloadable statement | P2 |
| M-ERN-08 | Clawback / dispute notice | Rf | Why a reward was reversed + appeal | P1 |
| M-ERN-09 | Appeal a clawback | Rf | Submit evidence for review | P2 |

### Missions, Quests & Gamification — `M-GAM`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-GAM-01 | Missions / quests list | Rf | Refer + friend completes X = both earn | P2 |
| M-GAM-02 | Mission detail & progress | Rf | Steps, progress, reward | P2 |
| M-GAM-03 | Streaks & milestones | Rf | Consecutive activity rewards | P2 |
| M-GAM-04 | Ranks / tiers & badges | Rf/Am | Status, perks per tier, progression | P2 |
| M-GAM-05 | Leaderboards | Rf/Am/Ag | Friends / estate / campaign / global | P2 |
| M-GAM-06 | Contests & challenges | Rf/Am | Time-bound competitions (e.g. World Cup) | P2 |
| M-GAM-07 | Rank-up / reward celebration | Rf | Reward moment, share hook | P2 |

### Campaigns & Offers — `M-CMP`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-CMP-01 | Active campaigns | Rf | What's promotable now + reward terms | P1 |
| M-CMP-02 | Campaign detail | Rf | Eligibility, reward, vesting, end date | P1 |
| M-CMP-03 | Featured / seasonal | Rf | Spotlighted campaigns (property, sport, festive) | P2 |

### Ambassador Zone — `M-AMB`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-AMB-01 | Ambassador dashboard | Am | Advanced funnel: clicks → conversion → earnings | P2 |
| M-AMB-02 | Creative toolkit | Am | Banners, captions, vanity links, assets | P2 |
| M-AMB-03 | Referred-audience list | Am | Status of everyone referred | P2 |
| M-AMB-04 | Performance analytics | Am | Trends over time, best channels | P2 |
| M-AMB-05 | Ambassador payouts | Am | Higher-tier earnings + withdraw | P2 |
| M-AMB-06 | Tier progression & perks | Am | Path to next ambassador tier | P2 |

### Agent / Team Zone — `M-AGT`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-AGT-01 | Team / network dashboard | Ag | Network activity + **activity-based** override summary | P2 |
| M-AGT-02 | Onboard sub-referrers | Ag | Invite/manage team members | P2 |
| M-AGT-03 | Team member detail | Ag | Member's activity-driven earnings (not recruitment) | P2 |
| M-AGT-04 | Override earnings ledger | Ag | Override % of verified network activity, capped | P2 |
| M-AGT-05 | Team leaderboard & targets | Ag | Motivate, track team performance | P2 |
| M-AGT-06 | Team training / resources | Ag | Compliant scripts, materials | P2 |
| M-AGT-07 | Agent earnings disclosure | Ag | Caps, activity-based terms, compliance | P2 |

### Merchant / Partner Zone (mobile-lite) — `M-MER`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-MER-01 | Merchant referral dashboard | Me | Own campaign performance snapshot | P3 |
| M-MER-02 | Create / fund campaign (lite) | Me | Quick campaign + wallet funding | P3 |
| M-MER-03 | Campaign performance | Me | Conversions, spend, ROI | P3 |

### Trust, Account & Notifications — `M-ACC` / `M-NOT`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| M-ACC-01 | Verification & fraud status | Rf | Standing, flags, what to fix | P1 |
| M-ACC-02 | Report abuse / suspicious referral | Rf | Trust & safety reporting | P1 |
| M-ACC-03 | Earnings & tax info | Am/Ag | High-earner tax/withholding details | P2 |
| M-ACC-04 | Referral settings | Rf | Sharing, privacy, notification prefs | P1 |
| M-ACC-05 | Help & support | Rf | FAQ, chat, ticket | P1 |
| M-ACC-06 | Responsible-earning info | Rf | Honest expectations; anti-scam guidance | P1 |
| M-NOT-01 | Notifications center | Rf | Signup, activation, reward, vesting unlock, payout, clawback, rank-up | P1 |

## 8B. WEB ADMIN CONSOLE

### Overview / Growth — `A-SADM`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-SADM-01 | Growth dashboard | SA/Gr | K-factor, referral CAC, GMV, fraud rate, burn | P1 |
| A-SADM-02 | Program config | SA | Global rules, default tiers, caps | P1 |
| A-SADM-03 | RBAC & permissions | SA | Roles, scopes, entitlements | P1 |
| A-SADM-04 | Feature flags & kill-switches | SA | Phased rollout, emergency pause | P1 |
| A-SADM-05 | Integrations | SA | Fraud vendor, analytics, partner API | P2 |
| A-SADM-06 | Audit logs | SA/Cmp | All privileged actions, exportable | P1 |
| A-SADM-07 | Attribution & default-referrer config | SA/Cmp | Attribution window, priority rules, **fallback-referrer chain** (code → deep-link → agent/estate/campaign → regional → **house/Super-Admin**), grace-window length, house-account designation, budget-neutral vs funded-pool toggle (§7A) | P1 |

### Campaign Management — `A-CMP`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-CMP-01 | Campaign list | CM | All campaigns, status, performance | P1 |
| A-CMP-02 | Campaign builder | CM | Audience, reward, rules, eligibility, dates | P1 |
| A-CMP-03 | Reward structure config | CM/Fin | Flat / dynamic / LTV-priced + vesting/holdback | P2 |
| A-CMP-04 | Targeting & segmentation | CM | Cohorts, vertical, geography, behaviour | P2 |
| A-CMP-05 | A/B test setup & results | CM/Gr | Variant offers, lift analysis | P2 |
| A-CMP-06 | Budget & cap config | CM/Fin | Per-campaign caps, ROI guardrails | P1 |
| A-CMP-07 | Throttle / pause controls | CM/Rsk | Rate-limit, auto-pause on anomaly | P1 |
| A-CMP-08 | Cross-vertical orchestration | CM | Coordinate campaigns across modules/mini-apps | P3 |
| A-CMP-09 | Template library | CM | Reusable campaign templates | P2 |
| A-CMP-10 | Campaign analytics | CM/Gr | Funnel, conversion, cost per activation | P1 |

### Rewards & Ledger — `A-RWD`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-RWD-01 | Reward ledger | Fin/CM | All rewards across every state | P1 |
| A-RWD-02 | Vesting / holdback management | Fin | Release schedules, conditions | P2 |
| A-RWD-03 | Reward catalog management | CM | Currencies, redemption items, values | P2 |
| A-RWD-04 | Manual grant / adjustment | Fin | Discretionary rewards/corrections (audited) | P1 |
| A-RWD-05 | Clawback management | Rsk/Fin | Reverse fraudulent/invalid rewards | P1 |

### Finance / Payouts — `A-FIN`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-FIN-01 | Payout queue & approvals | Fin | Approve/track payouts to wallets | P1 |
| A-FIN-02 | Reconciliation | Fin | Reward ledger ↔ wallet/payout | P1 |
| A-FIN-03 | Budget & burn monitoring | Fin | Real-time spend vs budget, alerts | P1 |
| A-FIN-04 | Reward-to-LTV / unit economics | Fin/Gr | Are we paying ≤ target % of LTV? | P2 |
| A-FIN-05 | Float management | Fin | Reward float positions | P1 |
| A-FIN-06 | Tax / withholding reporting | Fin/Cmp | High-earner reporting | P2 |
| A-FIN-07 | Merchant funding & settlement | Fin | Referral-as-a-platform funding/settlement | P3 |

### Risk & Fraud — `A-RSK`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-RSK-01 | Fraud dashboard | Rsk | Alerts, risk scores, burn anomalies | P1 |
| A-RSK-02 | Rules engine | Rsk | Velocity, device, KYC-dedup, behavioural rules | P1 |
| A-RSK-03 | Investigation workbench | Rsk | Case management, evidence, decisions | P1 |
| A-RSK-04 | Blocklists / allowlists | Rsk | Block devices/identities/accounts | P1 |
| A-RSK-05 | Clawback execution & history | Rsk | Trigger + track recoveries | P1 |
| A-RSK-06 | Identity / device graph | Rsk | Link analysis: collusion, device farms, self-referral | P3 |
| A-RSK-07 | Manual review queue | Rsk | Hold suspicious rewards for review | P1 |

### Compliance — `A-CMPL`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-CMPL-01 | Pyramid-line & tier-cap policy | Cmp | Configure tier limits, activity-based rules, jurisdiction toggles | P1 |
| A-CMPL-02 | Disclosure / T&Cs management | Cmp | Versioned terms, earnings disclosures | P1 |
| A-CMPL-03 | AML monitoring | Cmp | Reward-linked transaction surveillance | P2 |
| A-CMPL-04 | Regulatory reporting | Cmp | SEC/FCCPC/CBN-aligned reports | P2 |
| A-CMPL-05 | Consent / data management | Cmp | NDPC consent records, retention | P1 |
| A-CMPL-06 | Earnings-claim review | Cmp | Police exaggerated/misleading earning claims | P2 |

### Ambassadors & Agents — `A-AMB`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-AMB-01 | Ambassador directory & tiers | CM | Manage ambassadors, tier assignment | P2 |
| A-AMB-02 | Application / approval queue | CM/Cmp | Vet ambassador/agent applicants | P2 |
| A-AMB-03 | Agent network management | CM/Cmp | Downline structures, depth, caps | P2 |
| A-AMB-04 | Override policy config | Cmp/Fin | Enforce **activity-based** overrides + caps | P2 |
| A-AMB-05 | Performance & payouts oversight | CM/Fin | Monitor ambassador/agent earnings | P2 |
| A-AMB-06 | Content / creative approval | CM/Cmp | Approve ambassador assets (compliance) | P2 |

### Merchants / Partners — `A-MER`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-MER-01 | Partner directory & onboarding | CM | KYC/vet partners | P3 |
| A-MER-02 | Partner campaign approval | CM/Cmp | Review/approve funded campaigns | P3 |
| A-MER-03 | Funding & revenue-share config | Fin | Take-rate, funding rules | P3 |
| A-MER-04 | Partner analytics & billing | Fin | Spend, performance, invoices | P3 |
| A-MER-05 | API key / SDK management | SA | Partner credentials, scopes | P3 |

### Users & Graph — `A-USR`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-USR-01 | User 360 (referral) | SA/Rsk | All roles, earnings, referrals, risk score | P1 |
| A-USR-02 | Referral graph viewer | Rsk/Gr | Visualise who referred whom | P2 |
| A-USR-03 | Manual intervention | SA/Rsk | Adjust, suspend, reverse, re-verify | P1 |
| A-USR-04 | Support tools | SA | Resolve user referral/earning issues | P1 |
| A-USR-05 | House / system account ledger | SA/Fin/Cmp | Super-Admin house capture of no-code signups; **non-withdrawable**, segmented from user payouts; excluded from override chains; volume & value of house-attributed rewards | P1 |
| A-USR-06 | Attribution reassignment & disputes | SA/Rsk/Cmp | Reassign attribution (late claim, fraud correction, dispute); reverse prior accrual incl. house; **separation-of-duties co-sign** for house-benefiting changes; full audit | P1 |

### Gamification Admin — `A-GAM`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-GAM-01 | Mission / quest builder | CM | Define quest conditions + rewards | P2 |
| A-GAM-02 | Tier / rank / badge config | CM | Set ranks, thresholds, perks | P2 |
| A-GAM-03 | Leaderboard config | CM | Scope, reset cycles, prizes | P2 |
| A-GAM-04 | Contest / challenge management | CM | Time-bound events | P2 |

### Analytics / BI — `A-BI`
| ID | Screen | Roles | Purpose | Phase |
|---|---|---|---|---|
| A-BI-01 | Growth & K-factor dashboard | Gr | Viral coefficient, share rate, trends | P1 |
| A-BI-02 | Acquisition funnel | Gr | Invite→click→signup→KYC→activate→retain | P1 |
| A-BI-03 | Referral CAC vs paid CAC | Gr/Fin | Channel efficiency | P1 |
| A-BI-04 | Cohort LTV & retention | Gr | Value of referred users over time | P2 |
| A-BI-05 | Channel / share-surface performance | Gr | Which surfaces/contexts convert | P2 |
| A-BI-06 | Vertical attribution | Gr | Which verticals' referrals drive value | P2 |
| A-BI-07 | Custom reports / exports | Gr | Build & schedule exports | P2 |
| A-BI-08 | Organic vs referred segmentation | Gr | Separate **house-default (organic)** from genuine viral referrals; true K-factor excludes house captures (§7A.6) | P1 |

---

## 9. Cross-Cutting Flows (design end-to-end)

1. **Compliant earn loop:** invite `M-INV-01` → friend signs up + KYC → qualifying action → reward **vests** `M-ERN-03` → eligible → withdraw to wallet `M-ERN-04`. Reward is conditioned on real activity, not signup.
2. **Fraud interception:** event fires → rules engine `A-RSK-02` scores → suspicious held in review `A-RSK-07` → clawback if invalid `A-RSK-05`/`M-ERN-08`. KYC dedup blocks self-referral at source.
3. **Agent override (activity-based):** team member transacts → verified activity → capped override accrues `M-AGT-04` → policy-enforced by `A-AMB-04`. No earning on recruitment alone.
4. **Dynamic reward:** campaign sets LTV-priced reward `A-CMP-03` → budget governor `A-CMP-06` caps burn → finance reconciles `A-FIN-02`.
5. **Merchant-funded campaign:** partner creates + funds `M-MER-02`/`A-MER-03` → compliance approves `A-MER-02` → runs on rails → settlement `A-FIN-07`.
6. **Cross-vertical referral:** referrer promotes property/bills `M-INV-09` → event attributed → vertical revenue justifies + funds reward → attribution shown `A-BI-06`.
7. **No-code / default attribution (§7A):** user signs up, **blank code** `M-ONB-10` → resolver runs the fallback chain (deep-link → agent/estate/campaign → regional → **house/Super-Admin**) → referrer-side bonus accrues to house ledger `A-USR-05`, tagged `house_default` (excluded from K-factor `A-BI-08`). If the user **claims a valid code** within the grace window `M-INV-10` → reassignment tool `A-USR-06` reverses the house accrual and re-accrues to the real referrer (co-signed, audited). After the window → attribution locks.

---

## 10. Non-Functional Requirements

- **Fraud-by-design:** KYC/BVN/NIN dedup (one earning identity per human), device fingerprinting, velocity limits, behavioural cohorts, vesting/holdbacks, real-time clawback, kill-switches.
- **Compliance-by-design:** activity-based earning enforced in the reward engine; tier caps; versioned disclosures; AML monitoring on reward-linked flows; NDPC consent; jurisdiction toggles.
- **Attribution integrity (§7A):** no signup left unattributed; house/Super-Admin default is a **non-withdrawable, segregated** ledger, **excluded from override chains and from K-factor**; house-benefiting reassignments require **separation-of-duties co-sign**; all reassignments fully audited.
- **Security:** least-privilege RBAC, full immutable audit trail on rewards/clawbacks/payouts/config, encryption at rest/in transit.
- **Performance/reliability:** idempotent attribution (no double-reward), real-time reward ledger, instant wallet payout, accurate reconciliation.
- **Scalability:** event-driven engine handles viral spikes without budget overrun (auto-throttle).

---

## 11. Architecture & Event Model

Event-driven engine. Verticals/mini-apps fire events — `link_created, click, signup, kyc_completed, first_transaction, qualifying_action, retained_Nd` — via a shared SDK/API. The engine attributes (link/code/name/deep-link, idempotent, fraud-aware) **via the §7A resolver — running the fallback chain and defaulting unattributed signups to the house/Super-Admin account** — writes to a **reward ledger** (earned → pending → vesting → eligible → paid → clawed-back), and fulfils via wallet/payout. Reuses KYC (dedup), notifications (nudges), agent network (offline). Optional fraud-vendor integration (SEON/Sift). Partner API exposes campaign creation/funding for referral-as-a-platform.

---

## 12. Analytics & Event Tracking

invite_sent, invite_channel, link_clicked, signup_attributed, attribution_defaulted_to_house, referral_code_late_claimed, attribution_reassigned, invalid_code_attempt, self_referral_blocked, kyc_completed, qualifying_action, reward_accrued, reward_vested, reward_paid, reward_clawed_back, fraud_flagged, fraud_confirmed, ambassador_applied, agent_network_joined, override_accrued, campaign_launched, campaign_paused, budget_threshold_hit, merchant_campaign_funded, rank_up, mission_completed, withdrawal_completed.

---

## 13. Risks, Assumptions & Open Questions

- **Pyramid-line exposure (highest):** multi-tier overrides must be activity-based, capped, disclosed, and reviewed by Nigerian counsel (SEC/FCCPC/CBN). The product enforces it; legal must bless the exact tier design. *Open: how many tiers, what caps?*
- **Reward-budget burn:** viral success can outrun budget; governor + auto-pause are P1, not P2.
- **Fraud sophistication:** device farms / synthetic identities; decide **build vs integrate** (SEON/Sift) for advanced detection.
- **Dynamic-reward cold start:** LTV-priced rewards need data; start with conservative flat + vesting, evolve to dynamic.
- **Benchmark pressure:** PalmForce sets user expectations on instant payout and downline earning; differentiate on trust + anti-fraud + cross-vertical value, not just bigger bounties.
- **House-default economics (§7A):** assigning the referrer-side bonus to the Super-Admin/house account is **internal accounting, not revenue** — it only has value if the pool is either suppressed (budget-neutral, recommended) or deliberately funded to bankroll campaigns. *Open: which model? And does the organic user get any welcome reward?*
- **House-default abuse / governance:** the house account must be a governed system account (not an individual's wallet), excluded from override chains, with separation-of-duties on reassignments — or it becomes a channel to quietly inflate internal "earnings."
- **Attribution-window & fallback-chain tuning (§7A):** deep-link grace, late-claim window length, and whether to use agent/estate/campaign mid-tiers vs jumping straight to the global house. *Open: simplest chain vs context-scoped chain?*
- **Open:** single-market (NG) vs multi-market jurisdiction model now? In-house vs vendor fraud? Tax/withholding handling for high earners?

---

## 14. Screen Count Summary

| Surface | Modules | Screens |
|---|---|---|
| Mobile app | 11 modules | ~60 |
| Admin console | 11 workspaces | ~66 |
| **Total** | | **~126 screens** (exhaustive baseline; several expand into sub-states) |
