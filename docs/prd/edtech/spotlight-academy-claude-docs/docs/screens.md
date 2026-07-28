# Mobile Screen Inventory

One app, role-aware via single identity. IDs are **stable references** for design, tickets, and QA.
Inline states: empty / loading / error / offline / locked / success. Phase tags in `BUILD-PLAN.md`.

## A. Onboarding & Authentication
| ID | Screen | Purpose & key states |
|---|---|---|
| A1 | Splash | Session + curriculum-version check; routes to onboarding or home. |
| A2 | Welcome carousel | Value props (learn/play/earn); skip. |
| A3 | Sign up | Phone/email via Paymax SSO; existing users link instantly. |
| A4 | OTP verification | Code entry; resend; expired/error. |
| A5 | Role selection | Learner or Parent (additive). |
| A6 | Age / KYC tier capture | DOB → tier + child-safety rules; minor → consent path. |
| A7 | Guardian consent / link | Minor links to guardian; consent recorded (audit). |
| A8 | Profile setup | Name, avatar, optional school; multi-child for parents. |
| A9 | Class & curriculum select | P1–SSS3; auto-detect new vs legacy by entry class. |
| A10 | Stream selection | SSS: Science / Humanities / Commercial. |
| A11 | Trade subject selection | JSS+: one trade (solar/fashion/gsm/agric/beauty…). |
| A12 | Goal setting | Exam target + daily goal. |
| A13 | Permissions | Notifications, storage, low-data preference. |
| A14 | Diagnostic — intro | Explains placement; optional skip. |
| A15 | Diagnostic — runner | Adaptive placement questions. |
| A16 | Diagnostic results | Strengths/gaps; recommended path. |
| A17 | Login | Phone/email + OTP/biometric; device trust. |
| A18 | Forgot / recover access | Reset via OTP. |
| A19 | Profile switcher | Family multi-profile / role switch. |

## L. Learner Home & Core Learning
| ID | Screen | Purpose & key states |
|---|---|---|
| L1 | Home / Today | Plan, streak, continue, recommendations; offline banner. |
| L2 | Daily goal & streak | Goal progress, streak calendar, freeze tokens. |
| L3 | My subjects | Grid with progress rings. |
| L4 | Subject landing | Units/topics, mastery state, exam-relevance tags. |
| L5 | Topic/unit landing | Lessons + practice + mastery check; locked/unlocked. |
| L6 | Lesson player | Edutainment video; low-data, captions, speed, audio-only. |
| L7 | Lesson transcript/notes | Transcript; personal notes; bookmark. |
| L8 | Interactive lesson | Hands-on interactive/simulation. |
| L9 | Practice question | MCQ + rich types; hints; instant feedback. |
| L10 | Practice set results | Score, worked explanations, remediation. |
| L11 | Adaptive practice | Personalised set on weak objectives. |
| L12 | Mastery check | Gate to next unit; configurable threshold. |
| L13 | Quiz results & remediation | Outcome + next steps. |
| L14 | Search | Lessons, topics, past questions. |
| L15 | Bookmarks / saved | Saved items. |
| L16 | My notes | All personal notes. |
| L17 | Downloads / offline library | Bundles; storage; sync status. |

## X. The Crown — Exam Arenas
| ID | Screen | Purpose & key states |
|---|---|---|
| X1 | Arena hub | Choose CCE/BECE/WASSCE/NECO/UTME/NABTEB. |
| X2 | Arena home | Readiness, syllabus coverage, countdown. |
| X3 | Subject combination setup | UTME: subjects by course; requirement guidance. |
| X4 | Topic drills | Targeted drills by topic/difficulty. |
| X5 | Past questions browser | By year/topic; filter; bookmark. |
| X6 | Mock setup | Full / single-subject / timed; pick blueprint. |
| X7 | CBT exam simulator | Timed full-screen: navigator, flag, calculator; offline-capable. |
| X8 | CBT submit & confirm | Review unanswered/flagged; submit guard. |
| X9 | Score breakdown | Per-subject/topic; time analysis. |
| X10 | Performance analytics | Weakness heatmap, trend, predicted score. |
| X11 | Exam leaderboard | Arena ranking; friends/national. |
| X12 | Exam clinic | Live/recorded tips; Q&A. |
| X13 | Readiness report | Shareable summary; exam-day checklist. |

## G. Gamification & Learn-to-Earn
| ID | Screen | Purpose & key states |
|---|---|---|
| G1 | Progress map / journey | Visual path; next milestone. |
| G2 | XP & levels | History; level perks. |
| G3 | Badges & achievements | Earned/locked with criteria. |
| G4 | Challenges & quests | Daily/weekly + sponsor-branded. |
| G5 | Leaderboards | Class/school/national/friends; weekly resets. |
| G6 | Rewards center | Earned credits & points; how to earn. |
| G7 | Redeem rewards | Points → wallet/airtime/data/voucher. |
| G8 | Reward history | Earnings/redemptions ledger. |
| G9 | Refer & earn | Invite; track referrals/bonuses. |
| G10 | My certificates | Academic + trade credentials. |
| G11 | Credential detail | Verifiable cert; share/QR/verify. |

## S. Trade & Skills (the Moat)
| ID | Screen | Purpose & key states |
|---|---|---|
| S1 | Trade track hub | Chosen trade; modules & projects. |
| S2 | Trade lesson | Practical, project-based. |
| S3 | Project/portfolio submission | Upload work; rubric. |
| S4 | Skill assessment | Practical; pass → credential. |
| S5 | Trade credential | Verifiable skill certificate. |
| S6 | Earning opportunities feed | Paymax roles unlocked (driver/agent/creator/merchant/service). |
| S7 | Opportunity detail & apply | Eligibility; routes into Paymax onboarding. |
| S8 | Mentor connect | Optional mentor matching. |

## C. Live, Community & Notifications
| ID | Screen | Purpose & key states |
|---|---|---|
| C1 | Live classes schedule | Upcoming/live/replay. |
| C2 | Live class room | LiveKit; chat; raise-hand; moderated. |
| C3 | Replay player | Recorded playback. |
| C4 | Study groups / cohorts | Join cohort; group goals. |
| C5 | Discussion / Q&A | Moderated subject Q&A. |
| C6 | Notifications center | Lessons, rewards, exam reminders, parent msgs. |
| C7 | Announcements | Program/sponsor announcements. |

## W. Wallet, Plans & Store
| ID | Screen | Purpose & key states |
|---|---|---|
| W1 | Wallet & rewards balance | Spendable vs reward; mini-statement. |
| W2 | Subscription plans | Freemium tiers; compare. |
| W3 | Plan checkout | Pay-now or BNPL; promo/scholarship codes. |
| W4 | BNPL setup | Instalment schedule; eligibility. |
| W5 | Exam bundle store | Premium prep packs per exam. |
| W6 | Bundle/item detail | Contents, price, buy. |
| W7 | Access card redemption | Agent-sold prepaid → unlock access/data. |
| W8 | Payment methods | Manage cards/accounts. |
| W9 | Transaction history & receipts | Purchases, refunds, receipts. |

## P. Parent / Guardian
| ID | Screen | Purpose & key states |
|---|---|---|
| P1 | Parent home | Children overview; alerts. |
| P2 | Add / link child | Create/link; consent. |
| P3 | Child progress dashboard | Engagement, mastery, exam readiness. |
| P4 | Child subject detail | Performance by subject/topic. |
| P5 | Usage controls | Screen-time, content/age controls, allowed hours. |
| P6 | Progress reports | Weekly/termly; downloadable/shareable. |
| P7 | Purchase approvals | Approve child purchase/redemption. |
| P8 | EduPay — fees hub | Linked schools & fee schedules. |
| P9 | Pay school fees | Full or BNPL instalments. |
| P10 | Save-for-school pot | Goal savings toward fees. |
| P11 | Scholarships & sponsors | Browse/apply. |
| P12 | Billing & subscriptions | Plans, methods, invoices. |
| P13 | Parent notifications | Alerts, reports, approvals. |

## T. Tutor & School (Phase 4)
| ID | Screen | Purpose & key states |
|---|---|---|
| T1 | Tutor onboarding & KYC | Verify; subjects; payout setup. |
| T2 | Tutor profile | Bio, ratings, availability. |
| T3 | Class roster | Manage students/cohorts. |
| T4 | Assign content/homework | Push lessons/assessments; due dates. |
| T5 | Review & grade | Mark work; feedback. |
| T6 | Host live class | Schedule + run LiveKit. |
| T7 | Earnings & payouts | Ledger; withdraw. |
| T8 | School admin (lite) | Class dashboards; licence; bulk enrol. |

## Z. Account, Settings & Support
| ID | Screen | Purpose & key states |
|---|---|---|
| Z1 | Profile & edit | Details, avatar, class/stream/trade. |
| Z2 | Curriculum & subjects settings | Change class/stream/trade; version. |
| Z3 | Notification settings | Channel/category prefs. |
| Z4 | Data & downloads settings | Low-data, wifi-only, clear cache. |
| Z5 | Language settings | English + Nigerian languages. |
| Z6 | Security | PIN, biometrics, devices, sessions. |
| Z7 | KYC / verification status | Tier; upgrade prompts. |
| Z8 | Privacy & consent | Data/child-safety/marketing; export/delete. |
| Z9 | Help center / FAQ | Self-help. |
| Z10 | Contact support / chat | Ticket/chat. |
| Z11 | Report content / issue | Flag → moderation queue. |
| Z12 | About / legal | Terms, privacy, licences. |
| Z13 | Logout / delete account | Session end; deletion flow. |

## E. ECCE / Pre-Primary (Optional, Phase 0)
| ID | Screen | Purpose & key states |
|---|---|---|
| E1 | Kids home (simplified) | Large-target, parent-gated, screen-light. |
| E2 | Play-learn activity | Phonics, numeracy, shapes; audio-led. |
| E3 | Parent gate | Age/math gate before settings/purchases. |
