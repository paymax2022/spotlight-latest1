# Product Requirements Document (PRD)
# "Connect" — Social Discovery, Live Streaming, Voting & Gifting
### A module of the Paymax super app · Nigeria-first (Africa-ready)

| Field | Value |
|---|---|
| Product | Connect (unified Dating + Networking, with Live Streaming, Voting, Gifting, Gamification) |
| Parent | Paymax super app (shared Auth, RBAC, Wallet, Map services) |
| Primary market | Nigeria → expansion across Africa |
| Platforms | iOS, Android (mobile-first, low-bandwidth aware); Web Admin Console |
| Status | Draft v1.0 — for development planning |
| Owner | `<<Product Lead>>` |

> **How to read this PRD.** Sections 1–9 define product, users, scope, the functional modules, the Tier/AML compliance core, and RBAC. Section 10 is the **complete mobile app screen inventory**. Section 11 is the **complete Admin Console screen inventory**. Sections 12–17 cover integration, non-functional requirements, analytics, phased delivery, and risks. Verify all `<<placeholders>>` and confirm current CBN limits with counsel before build.

---

## 1. Executive summary
Connect is a single social product inside Paymax that merges **dating** and **networking** into one experience (selectable *intent modes*) and layers in **live streaming, voting, real-money gifting, and gamification**. It reuses the super-app's **single sign-on, centralized RBAC, shared wallet, and map service** rather than rebuilding them.

The defining design decision: **a "gift" is a real wallet-to-wallet money transfer wrapped as a gamified element** (a flower, rose, crown). The recipient receives spendable, withdrawable Naira — not a cosmetic token. Because real value moves between users, a **tiered KYC/limits system aligned to CBN's three-tier framework** is the AML backbone that gates how much money can be sent, received, and withdrawn at each verification level.

**Top differentiators:** native wallet gifting with built-in KYC tiers; Nigerian identity rails (BVN/NIN); cross-product gamification and voting culture (BBNaija-style fan voting); low-bandwidth-first streaming.
**Top risks:** AML/regulatory exposure (money transmission, NFIU reporting), gambling-adjacency of paid voting, dating trust & safety, and data-cost sensitivity. These are treated as first-class throughout.

## 2. Goals & success metrics
**Business goals:** drive super-app engagement and wallet velocity; create a creator-monetization revenue line (gift/vote take-rate + premium); deepen cross-module retention.

**Success metrics (targets set per launch plan):**
- *Activation:* install → KYC Tier-1 completion rate; % using both date and network modes.
- *Engagement:* DAU/MAU, sessions/user, match/connection rate, stream watch-time, votes cast, streak retention, data-saver adoption.
- *Monetization:* gift + paid-vote GMV, take-rate revenue, payer conversion, creator earnings & withdrawal health, premium retention.
- *Trust/AML:* report time-to-action, fraud/chargeback rate, **AML alert volume and 24-hour STR/SAR turnaround**, ban accuracy/appeal-overturn rate, vote-integrity score.

## 3. Personas
1. **Seeker (dating user)** — wants safe, authentic matches nearby; values verification and safety tools.
2. **Networker** — wants professional/interest connections, communities, and events; wants romantic-intent kept separate.
3. **Viewer/Fan** — watches live streams, votes, and gifts; motivated by status and leaderboards.
4. **Creator/Streamer** — broadcasts, earns gifts/paid votes, withdraws earnings; needs Tier 2/3 KYC.
5. **Host/Agency** — manages multiple creators (later phase).
6. **Admin roles** — moderator, finance/payout admin, **compliance officer**, support agent, super-admin (Section 9).

## 4. Scope
**In scope (V1):** unified Connect discovery (date+network modes), profiles & verification, messaging, live streaming (1:many, co-host, PK battles), free + paid voting, wallet gifting, tier/KYC/AML, gamification, premium/boosts, full Admin Console.
**Out of scope (V1, backlog):** marketplace/commerce, full agency tooling, in-app dating-event ticketing payments beyond wallet, multi-currency beyond NGN, web consumer app.

## 5. Information architecture & navigation (mobile)
**Bottom navigation (5 tabs):**
1. **Discover** — Connect feed/stack with mode toggle (Date / Network / Discover), filters, map view.
2. **Live** — stream discovery, categories, nearby, voting/contests.
3. **Create (center action)** — Go-Live / Create post / Create event / Start poll (role- & tier-gated).
4. **Inbox** — messages, connection/match requests, notifications.
5. **Me** — unified profile, wallet/tier, gamification, settings.

**Global:** search, notifications center, safety center, language switcher.

## 6. Functional modules

### 6.1 Connect — Discovery, Matching & Networking
- **Intent modes:** Date / Network / Discover, switchable; the UI and recommendation logic adapt per mode. A **hard wall** separates romantic-intent data/visibility from professional-intent data (per-mode visibility controls, consent, data minimization).
- **Discovery:** algorithmic + intent-based + **proximity via Map service**; compatibility scoring (date) and skill/industry/interest matching (network).
- **Profiles:** unified, mode-aware; photos, bio, prompts, interests, verification badges; networking adds headline, skills, endorsements.
- **Messaging:** text, media, voice notes, voice/video calls; icebreakers; safety gating (e.g., match-before-message in date mode; request-to-connect in network mode).
- **Communities & events:** interest groups; in-person events discovered via Map service.

### 6.2 Live Streaming
- **Formats:** 1:many, multi-guest/co-host, **PK battles**, audio rooms.
- **Low-bandwidth first:** adaptive bitrate, audio-only fallback, explicit data-cost indicators, data-saver mode.
- **Discovery:** by interest, **location (Map)**, social graph, trending.
- **Creator monetization:** earns via **gifts and paid votes** to the wallet; **going live and payouts are tier-gated** (Tier 2+).
- **Moderation:** automated + human; host controls (mute/kick/ban viewer); platform intervention from Admin.
- **Anti-fraud:** bot-viewer detection, fake-gifting/gift-laundering controls, velocity & pattern monitoring.

### 6.3 Voting
- **Formats:** free polls, **paid voting** (PK battles, contests, talent/fan voting), leaderboards.
- **Paid votes = wallet money transfers** → inherit tier limits + AML monitoring.
- **Gambling-adjacency safeguard:** if paid votes drive prizes, design to avoid chance-based payout to voters; transparent rules; **explicit legal review** of Nigerian lottery/gaming law before enabling prize mechanics.
- **Integrity:** bot/sybil defense, vote-buying detection, rate limits, auditable results.

### 6.4 Gifting (wallet-to-wallet, gamified)
- **Mechanic:** sender wallet → recipient wallet, in real Naira, rendered as a gift (flower → rose → crown…). Recipient balance is **spendable/withdrawable**.
- **Ledger:** every gift is a real ledger entry with the gamified element as metadata; fees/take-rate applied per config; dispute/reversal rules defined.
- **Tier-gated limits** on per-transaction, daily, and cumulative gifting **sent and received**; on hitting a limit the user is prompted to upgrade tier (KYC).
- **Anti-abuse:** structuring/smurfing detection, collusive gifting-ring detection, refund/chargeback handling.
- **Strict currency separation:** real-money wallet (gifts/votes) is kept distinct from non-cash gamification points/coins.

### 6.5 Gamification (cross-cutting)
- XP, levels, streaks, badges, missions, daily check-ins, seasons/events, leaderboards, referrals.
- **Two-currency clarity:** non-cash engagement currency (earned by activity) never silently converts to real money; any conversion is explicitly governed and AML-assessed.
- Status/perks (e.g., higher gifting ceilings, go-live access) gated by **RBAC + KYC tier**.
- Anti-abuse: anti-grinding/farming, fake-engagement and reward-exploit defenses.

## 7. Tier / KYC / AML model (compliance core)

> Anchored to the **CBN three-tier KYC framework** and current limits. Treat thresholds as **configurable** in Admin and confirm against live CBN regulation before launch; CBN limits change and AML baseline standards are tightening (automated AML roadmap mandated by **10 June 2026**).

| Tier | Verification required | Money-movement limit (align to CBN) | Connect privileges |
|---|---|---|---|
| **Tier 0** (app-only, unverified) | Phone + name (super-app account) | **No money send/receive/withdraw** | Browse, match/connect, chat, watch streams, free voting only |
| **Tier 1** | **BVN or NIN** linked (real-time NIBSS/NIMC lookup) | ~**₦30,000/day** | Send/receive small gifts, paid votes within limit, basic gamification; **no withdrawal / no go-live monetization** |
| **Tier 2** | BVN **and** NIN + government photo ID + proof of address | ~**₦500,000/day** | **Go live & earn**, send/receive gifts & paid votes, **withdraw within limit**, creator monetization |
| **Tier 3** | Tier 2 + **liveness check** + enhanced due diligence (proof of address, source of funds for high earners) | **No fixed limit** (enhanced monitoring) | Full creator/host payouts, highest gifting/withdrawal ceilings |

**AML/CTF controls (mandatory):**
- Real-time **transaction monitoring** with velocity & pattern rules; **structuring/smurfing** and gifting-ring detection.
- **Sanctions/PEP screening**; **enhanced due diligence** auto-triggered for PEPs, high-risk profiles, and unusually large flows.
- **STR/SAR and large/cross-border transaction reporting to the NFIU within 24 hours** of detection.
- Full recordkeeping, audit trails, and **NFIU-formatted reporting** from the Admin Console.
- Tier status is an **identity/RBAC attribute** consumed by every money-moving feature; limit checks happen server-side before any transfer.

## 8. Shared-service integration (reuse, don't rebuild)
- **Auth/SSO:** Connect uses super-app identity; no parallel login. Session, MFA, and device trust inherited.
- **Wallet:** APIs for `initiateGift`, `checkTierAndLimits`, `recordLedgerEntry`, `requestPayout`, `getBalance`. Gifting/voting/withdrawal all route through wallet + tier checks.
- **Map service:** APIs for proximity discovery, nearby events, stream geo-context, and geo-abuse signals.
- **RBAC:** Connect roles extend the central scheme (Section 9); permissions resolved centrally.
- **Where shared services must be extended:** tier attributes surfaced to Connect; gift ledger metadata; creator-payout state machine.

## 9. RBAC model (roles & key permissions)

| Role | Scope | Representative permissions |
|---|---|---|
| **User** | Consumer | Browse, match/connect, chat, watch, gift (tier-gated), vote, gamify |
| **Creator/Streamer** | Consumer+ | Go live (Tier 2+), receive gifts/votes, request payout, manage stream moderation |
| **Host/Agency** (later) | Creator mgmt | Manage linked creators, view aggregate earnings |
| **Moderator** | Admin | Review reports, moderate live/content, issue strikes/bans, manage appeals |
| **Finance/Payout Admin** | Admin | View ledgers, approve payouts/withdrawals, handle refunds/chargebacks |
| **Compliance Officer** | Admin | AML alert review, case management, **file STR/SAR to NFIU**, sanctions/PEP review, tier-limit config |
| **Support Agent** | Admin | User lookup, tickets, consented impersonation, limited actions |
| **Super-Admin** | Admin | Full config, RBAC management, feature flags, audit access |

All admin actions are **audit-logged**; least-privilege defaults; MFA enforced.

---

## 10. MOBILE APP — COMPLETE SCREEN INVENTORY

> IDs are grouped by flow. "States" lists key empty/error/loading/permission variants each screen must handle. Every money-moving screen must render current **tier, limit, and remaining allowance**.

### 10.1 Onboarding, Auth & Verification
| ID | Screen | Purpose / key elements |
|---|---|---|
| ON-01 | Splash | Brand load, session check, force-update gate |
| ON-02 | Welcome carousel | Value prop (date/network/live/gift), CTA to continue |
| ON-03 | SSO login handoff | Hand to super-app auth; returning-user fast path |
| ON-04 | OTP / biometric | Verify session (inherited from super app) |
| ON-05 | Permission priming | Location, camera, mic, notifications, contacts — rationale before OS prompt |
| ON-06 | Intent selection | Choose mode(s): Date / Network / Discover |
| ON-07 | Profile wizard — basics | Name, DOB, gender, location |
| ON-08 | Profile wizard — photos | Upload/reorder; primary photo; guidelines |
| ON-09 | Profile wizard — bio/prompts | Bio, prompts, interests, (networking) headline/skills |
| ON-10 | Profile wizard — preferences | Discovery prefs per mode |
| ON-11 | Verification intro | Why verify; tier benefits |
| ON-12 | Selfie/liveness capture | Liveness check; anti-spoof |
| ON-13 | BVN/NIN linkage | Enter/confirm BVN or NIN; NIBSS/NIMC lookup result |
| ON-14 | Tier status intro | Current tier, what each unlocks |
| ON-15 | Onboarding complete | Land on Discover |
States: permission-denied, lookup-failed, network-offline, photo-rejected.

### 10.2 Connect — Discovery & Matching (Date mode)
| ID | Screen | Purpose |
|---|---|---|
| DC-01 | Discover stack | Swipe/card discovery, mode toggle visible |
| DC-02 | Profile detail (expanded) | Full profile, photos, prompts, verify badges, actions |
| DC-03 | Filters & preferences | Distance, age, interests, verified-only, etc. |
| DC-04 | Map nearby view | Proximity discovery via Map service |
| DC-05 | Likes-you / who-liked-me | Inbound interest (premium gate optional) |
| DC-06 | It's-a-match modal | Match celebration, start chat / keep swiping |
| DC-07 | Daily picks | Curated daily recommendations |
| DC-08 | Boost/Spotlight purchase | Buy visibility (wallet) |
| DC-09 | Undo / rewind | Premium rewind |
States: empty-stack, out-of-area, no-more-likes.

### 10.3 Connect — Networking mode
| ID | Screen | Purpose |
|---|---|---|
| NW-01 | Networking feed | People/posts by industry/skill/intent |
| NW-02 | Professional profile | Headline, skills, endorsements, mutuals |
| NW-03 | Networking filters | Industry, skill, intent, location |
| NW-04 | Connection request | Send/accept with note |
| NW-05 | Communities list | Browse/join groups |
| NW-06 | Community detail/feed | Posts, members, rules |
| NW-07 | Create community | Name, topic, privacy |
| NW-08 | Events list | Nearby/upcoming via Map |
| NW-09 | Event detail | Info, location map, RSVP, attendees |
| NW-10 | Create event | Title, time, venue (map), capacity |
| NW-11 | Endorsements | Give/receive skill endorsements |

### 10.4 Unified profile & mode switching
| ID | Screen | Purpose |
|---|---|---|
| PR-01 | Mode toggle/sheet | Switch Date/Network/Discover |
| PR-02 | My profile (view) | Mode-aware self view |
| PR-03 | Edit profile | Edit fields per mode |
| PR-04 | Manage photos | Add/reorder/delete, primary |
| PR-05 | Privacy & visibility | Per-mode visibility, intent-wall controls |
| PR-06 | Verification badges | Status of selfie/BVN/NIN/ID |

### 10.5 Messaging & Inbox
| ID | Screen | Purpose |
|---|---|---|
| MS-01 | Inbox / conversations | All threads, unread, requests tab |
| MS-02 | Chat thread | Text, media, voice notes; safety tools |
| MS-03 | Icebreakers | Suggested openers |
| MS-04 | Message requests | Pending/blocked-by-default requests |
| MS-05 | In-chat safety | Block, report, share live location, unmatch |
| MS-06 | Voice call | Audio call UI |
| MS-07 | Video call | Video call UI, low-bandwidth fallback |
| MS-08 | Connection requests (network) | Accept/decline connect requests |
States: blocked, message-limit (free tier), media-upload-fail.

### 10.6 Live Streaming — Viewer
| ID | Screen | Purpose |
|---|---|---|
| LV-01 | Live tab / grid | Discover live streams |
| LV-02 | Live by category | Filter by topic |
| LV-03 | Live nearby (map) | Geo-based discovery |
| LV-04 | Stream viewer (single) | Video, chat overlay, gift/vote actions |
| LV-05 | Multi-guest / PK viewer | Split-screen PK battle, team gifting |
| LV-06 | Gift drawer | Select gift = wallet amount; shows tier/limit |
| LV-07 | Gift confirm | Confirms real money + remaining limit |
| LV-08 | Gift animation | Full-screen gift effect |
| LV-09 | Stream leaderboard | Top gifters / streamers |
| LV-10 | Creator profile (public) | Follow/subscribe, past streams |
| LV-11 | Mini-player | Persistent while browsing |
| LV-12 | Share stream | Share link/invite |
| LV-13 | Report stream | Reason flow |
| LV-14 | Data-saver/audio-only | Toggle quality |
States: stream-ended, limit-reached → upgrade tier, age-gate.

### 10.7 Live Streaming — Broadcaster/Creator
| ID | Screen | Purpose |
|---|---|---|
| LB-01 | Go-live setup | Title, category, tags, cover, location toggle |
| LB-02 | Pre-live tier/KYC gate | Blocks if below Tier 2; CTA to upgrade |
| LB-03 | Live broadcast (host) | Camera, host controls, earnings ticker |
| LB-04 | Invite co-host/guest | Search/invite |
| LB-05 | PK battle setup | Matchmaking, rules, duration |
| LB-06 | Host moderation | Mute/kick/ban viewer, pin message |
| LB-07 | Earnings overlay | Live gift/vote earnings |
| LB-08 | End-of-stream summary | Earnings, viewers, new followers |
| LB-09 | Creator dashboard | History, audience, earnings trends |
| LB-10 | Payout request | Withdraw earnings (tier-gated), status |

### 10.8 Voting
| ID | Screen | Purpose |
|---|---|---|
| VT-01 | Contests/polls list | Active and upcoming |
| VT-02 | Contest detail | Rules, contestants, prize info |
| VT-03 | Vote screen | Free vs paid vote selection |
| VT-04 | Paid-vote confirm | Wallet transfer confirm + limit |
| VT-05 | Results/leaderboard | Live tallies |
| VT-06 | Contestant profile | Profile + vote CTA |
| VT-07 | In-stream poll creator | Host starts a poll |
| VT-08 | My vote history | Past votes & spend |

### 10.9 Gifting & Wallet
| ID | Screen | Purpose |
|---|---|---|
| WL-01 | Wallet home | Balance, tier, daily limit remaining |
| WL-02 | Gift catalog | Gifts mapped to Naira amounts |
| WL-03 | Send gift flow | Pick recipient, gift, amount |
| WL-04 | Send gift confirm | Real-money confirmation + limit check |
| WL-05 | Gift received | Notification + animation, added to balance |
| WL-06 | Transaction history/ledger | All gifts/votes/transfers in & out |
| WL-07 | Add money / top-up | Fund wallet (super-app rails) |
| WL-08 | Withdraw / cash out | Tier-gated; bank destination |
| WL-09 | Tier status & benefits | Compare tiers, current tier |
| WL-10 | KYC upgrade flow | BVN/NIN → ID upload → liveness |
| WL-11 | Limit-reached prompt | Explain + upgrade CTA |
| WL-12 | Linked accounts | Bank/payment destinations |
States: insufficient-balance, limit-exceeded, kyc-pending, payout-rejected.

### 10.10 Gamification
| ID | Screen | Purpose |
|---|---|---|
| GM-01 | Progression hub | XP, level, badges |
| GM-02 | Missions/quests | Daily/weekly tasks |
| GM-03 | Daily check-in | Streak reward |
| GM-04 | Rewards center | Earn/redeem non-cash rewards |
| GM-05 | Leaderboards | Gifters, streamers, voters, regional |
| GM-06 | Seasons/events hub | Themed events |
| GM-07 | Achievements gallery | Earned badges |
| GM-08 | Referral / invite | Invite friends, track rewards |

### 10.11 Settings, Safety & Support
| ID | Screen | Purpose |
|---|---|---|
| ST-01 | Me / hub | Entry to profile, wallet, settings |
| ST-02 | Settings root | All settings categories |
| ST-03 | Account settings | Identity, linked super-app account |
| ST-04 | Privacy & visibility | Per-mode controls, blocked list |
| ST-05 | Notifications settings | Channel/topic toggles |
| ST-06 | Safety center | Tips, blocked users, report history |
| ST-07 | Report flow | Multi-step reason → submit |
| ST-08 | Block confirm | Confirm/undo |
| ST-09 | Appeal a strike/ban | Submit appeal, track status |
| ST-10 | Date safety / SOS | Share trip, emergency contact, check-in |
| ST-11 | Language settings | English, Pidgin, Hausa, Yoruba, Igbo |
| ST-12 | Data-saver settings | Quality/data controls |
| ST-13 | Premium/subscription | Plans, manage, restore |
| ST-14 | Help & support | FAQ, contact, ticket |
| ST-15 | Legal | Terms, privacy (NDPA), community guidelines |
| ST-16 | Delete/deactivate account | Data-deletion flow |

### 10.12 Notifications & system states
| ID | Screen | Purpose |
|---|---|---|
| SY-01 | Notification center | Activity, matches, gifts, system |
| SY-02 | Premium paywall | Upgrade prompts |
| SY-03 | Boost store | Buy boosts/spotlights |
| SY-04 | Purchase confirm | Wallet purchase result |
| SY-05 | Offline / no-connection | Retry, cached content |
| SY-06 | Empty states | Per-surface empties |
| SY-07 | Maintenance | Scheduled downtime |
| SY-08 | Force update | Block old versions |
| SY-09 | Geo-restriction | Region-gated features |

---

## 11. ADMIN MANAGEMENT CONSOLE — COMPLETE SCREEN INVENTORY

> Web app, role-scoped via central RBAC. Every screen respects least-privilege; every state-changing action is audit-logged.

### 11.1 Auth & shell
| ID | Screen | Purpose |
|---|---|---|
| AD-01 | Admin login | SSO + enforced MFA |
| AD-02 | Dashboard / overview | KPIs, alerts, queues snapshot (role-scoped) |
| AD-03 | Global search | Users, transactions, streams, tickets |
| AD-04 | Notifications/alerts | Critical AML/safety alerts |

### 11.2 User & Identity Management
| ID | Screen | Purpose |
|---|---|---|
| AU-01 | User list/search | Filter by tier, status, region, flags |
| AU-02 | User 360 detail | Profile, activity, wallet, devices, history |
| AU-03 | KYC/Tier status & history | Tier, BVN/NIN status, change log |
| AU-04 | Verification review queue | Selfie/liveness + ID document review |
| AU-05 | Suspend/ban/restrict | Apply/revoke restrictions with reason |
| AU-06 | Identity flags/watchlist | Add/remove flags, duplicate detection |
| AU-07 | Consented impersonation | Support view-as session (logged) |

### 11.3 RBAC & admin management
| ID | Screen | Purpose |
|---|---|---|
| AR-01 | Roles list | All roles + scopes |
| AR-02 | Role/permission editor | Granular permission matrix |
| AR-03 | Admin users | List/add admins |
| AR-04 | Assign roles | Map admins to roles |
| AR-05 | Permission groups | Reusable permission sets |
| AR-06 | Audit log | All admin actions, filterable |
| AR-07 | Session/MFA policy | Security config |

### 11.4 Content & live moderation
| ID | Screen | Purpose |
|---|---|---|
| AM-01 | Moderation queue | Reported content/users |
| AM-02 | Live stream monitor | Real-time grid of active streams |
| AM-03 | Stream intervene | Mute/cut/ban a live stream |
| AM-04 | Report detail | Evidence, history, resolution |
| AM-05 | Strike/ban management | Strikes ledger, escalation |
| AM-06 | Appeals queue | Review/decide appeals |
| AM-07 | Auto-moderation rules | Configure filters/thresholds |
| AM-08 | Banned words/media hashes | Block lists |
| AM-09 | Profile photo review | Photo verification queue |
| AM-10 | Community guidelines mgmt | Edit/publish guidelines |

### 11.5 Finance, gifting & AML
| ID | Screen | Purpose |
|---|---|---|
| AF-01 | Transactions ledger | Gifts, votes, transfers, top-ups, payouts |
| AF-02 | Transaction detail | Full trace, parties, tier checks |
| AF-03 | Wallet/float overview | System balances, settlement |
| AF-04 | Payout/withdrawal queue | Tier-gated approval workflow |
| AF-05 | Payout detail/approval | Approve/reject with checks |
| AF-06 | Refunds/chargebacks | Manage disputes |
| AF-07 | Revenue dashboard | Take-rate, GMV, trends |
| AF-08 | Creator earnings | Per-creator earnings & payouts |
| AF-09 | AML alert queue | Velocity/structuring/ring alerts |
| AF-10 | AML case management | Investigate, escalate, resolve |
| AF-11 | STR/SAR filing (NFIU) | Generate & track 24-hour reports |
| AF-12 | Sanctions/PEP screening | Screening results & disposition |
| AF-13 | Tier-limit configuration | Set/adjust tier thresholds |
| AF-14 | Fee/take-rate config | Configure gift/vote fees |
| AF-15 | Reconciliation/settlement | Reports & exports |

### 11.6 Voting integrity
| ID | Screen | Purpose |
|---|---|---|
| AV-01 | Contests management | Create/schedule/rules |
| AV-02 | Contest monitor | Live tallies & health |
| AV-03 | Vote-fraud detection | Bot/sybil/vote-buying signals |
| AV-04 | Results & prize mgmt | Finalize, prize config |
| AV-05 | Prize legal config | Rules to avoid gaming-law breach |

### 11.7 Gamification ops
| ID | Screen | Purpose |
|---|---|---|
| AG-01 | Missions/quests config | Create/edit tasks & rewards |
| AG-02 | Rewards catalog | Non-cash rewards config |
| AG-03 | Currency rules | Points/coins rules (no silent cash conversion) |
| AG-04 | Seasons/events config | Schedule themed events |
| AG-05 | Leaderboard config | Configure & moderate boards |
| AG-06 | Badge/achievement mgmt | Define achievements |
| AG-07 | Reward audit log | All reward grants |

### 11.8 Catalog, content & comms
| ID | Screen | Purpose |
|---|---|---|
| AC-01 | Gift catalog mgmt | Gift → amount mapping, animations |
| AC-02 | Premium/boost config | Plans, pricing |
| AC-03 | Banner/promo mgmt | In-app promos |
| AC-04 | Push/announcement composer | Targeted comms |
| AC-05 | Localization strings | Manage EN/Pidgin/Hausa/Yoruba/Igbo |

### 11.9 Analytics & growth
| ID | Screen | Purpose |
|---|---|---|
| AN-01 | Executive dashboard | North-star KPIs |
| AN-02 | Funnels | Onboarding/KYC/monetization funnels |
| AN-03 | Cohort/retention | Retention curves |
| AN-04 | Revenue/LTV | GMV, take-rate, LTV |
| AN-05 | Engagement | DAU/MAU, watch-time, votes |
| AN-06 | Safety/AML metrics | Reports, alerts, turnaround |
| AN-07 | Segmentation | By region/language/network type |
| AN-08 | Custom reports/export | Build & export |

### 11.10 Geo / Map & market ops
| ID | Screen | Purpose |
|---|---|---|
| AGE-01 | Geo distribution map | Users/streams by location |
| AGE-02 | Regional feature flags | Per-region toggles |
| AGE-03 | Geo-abuse detection | Location-spoofing/abuse |
| AGE-04 | Market management | Add/configure African markets |

### 11.11 Support / CRM
| ID | Screen | Purpose |
|---|---|---|
| AS-01 | Ticket queue | Triage support tickets |
| AS-02 | Ticket detail | Conversation + user link |
| AS-03 | Canned responses | Reusable replies |
| AS-04 | Escalations | Route to specialist teams |

### 11.12 Config & platform
| ID | Screen | Purpose |
|---|---|---|
| AP-01 | Feature flags | Global/region/cohort flags |
| AP-02 | A/B experiments | Configure & read results |
| AP-03 | System health | Service status, queues |
| AP-04 | Integrations config | Auth/Wallet/Map service settings |
| AP-05 | Notification templates | Manage templates |
| AP-06 | Compliance/audit export | Regulator-ready exports |

---

## 12. Non-functional requirements
- **Performance / low-bandwidth:** adaptive streaming, audio-only fallback, image compression, offline caching, explicit data-cost UI; target usable experience on 3G and entry Android devices.
- **Security:** server-side tier/limit enforcement, encrypted PII, secure media, rate limiting, fraud/bot defenses, MFA for admins.
- **Privacy (NDPA):** consent, data minimization, intent-wall between date/network data, data-subject access & deletion.
- **Reliability:** payment/ledger consistency (idempotent transfers), graceful degradation, settlement reconciliation.
- **Localization:** EN, Pidgin, Hausa, Yoruba, Igbo; Naira formatting; culturally appropriate content moderation.
- **Accessibility:** WCAG-aligned, large-text, captions for live where feasible.

## 13. Analytics & event taxonomy (starter)
Track per surface: `onboarding_step_completed`, `kyc_tier_changed`, `match_created`, `connection_made`, `message_sent`, `stream_started/ended`, `stream_watch_seconds`, `gift_sent` (amount, tier, limit_state), `paid_vote_cast`, `withdrawal_requested/approved`, `mission_completed`, `report_submitted`, `aml_alert_triggered`. Money events must log tier and limit context.

## 14. Phased delivery
- **MVP:** SSO + onboarding + Tier 0/1, Connect discovery (date+network), messaging, basic live viewing, **wallet gifting with tier limits**, free voting, core gamification, essential Admin (users, moderation, finance/AML basics, RBAC).
- **V1:** broadcasting + co-host/PK, paid voting, payouts (Tier 2/3), full AML tooling (NFIU filing, sanctions/PEP), leaderboards/seasons, premium/boosts, analytics suite.
- **Differentiators:** agency tooling, advanced AI matching/moderation, multi-market expansion, richer creator economy.

**Dependency gate:** no money-moving feature ships before tier/KYC + AML monitoring + NFIU reporting are live and tested.

## 15. Risks & open questions
- **AML/regulatory:** confirm money-transmission licensing coverage under Paymax; finalize NFIU reporting; meet CBN automated-AML expectations (roadmap deadline 10 June 2026).
- **Gaming law:** legal sign-off on paid-voting prize mechanics.
- **Trust & safety:** romance-scam defense, minor protection, live-moderation latency.
- **Intent-wall:** prevent dating/networking data leakage — needs design + QA focus.
- **Open:** exact current CBN tier limits (verify); take-rate/fee model; expansion market order; agency model timing.

## 16. Glossary
BVN — Bank Verification Number · NIN — National Identification Number · NIBSS/NIMC — identity databases · CBN — Central Bank of Nigeria · NFIU — Nigerian Financial Intelligence Unit · NDPA — Nigeria Data Protection Act · STR/SAR — Suspicious/Transaction Activity Report · PK battle — creator-vs-creator live competition · EDD — Enhanced Due Diligence.

---
*Confirm all `<<placeholders>>`, current CBN tier thresholds, NFIU reporting format, and gaming-law treatment of paid voting with qualified counsel before development.*
