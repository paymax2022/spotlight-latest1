# Paymax Connect — Product Spec (§1–§8)

> Reconciled to the **actual brownfield stack** (Gin monolith + Supabase + Next.js admin +
> Expo RN mobile). Where this differs from the dating `CLAUDE.md`/`BUILD-PLAN.md` (which assume
> Go microservices + MongoDB + Vue admin), **this document and `architecture.md` win** for
> implementation. The safety invariants in `dating/CLAUDE.md §28` are unchanged and binding.

## §1 What this is
Paymax Connect is a **trust-first, verified, 18+** dating / friendship / professional / creator /
event-networking module inside the existing Paymax + Spotlight super app. It is **not** a
swipe-only clone. The thesis: safer, more intentional connections that move into real life.

One user holds one identity with **N profile modes** (dating, friendship, professional, creator,
event), each with independent visibility and privacy.

## §2 Goals
- A trust-first MVP loop: onboard → verify (18+, phone, selfie) → discover curated matches →
  mutual-match → safe chat → plan a real-life date with safety rails.
- Multi-mode networking on one identity, gated by per-mode visibility.
- Every safety-critical decision is server-authoritative, audited, and reviewable.
- Monetization and ecosystem actions (rides, tickets, boosts) flow only through Paymax wallet.

## §3 Non-goals (this build)
- No teen/under-18 surface, ever.
- No escort/adult-service marketplace, paid companionship, or sugar arrangements.
- No user-to-user money/crypto/loan solicitation.
- No rebuilding of auth, wallet, KYC, or events — Connect **reuses** existing Paymax/Spotlight
  infrastructure (see `architecture.md`).

## §4 Personas
- **Seeker** — wants dating/friendship connections; values safety and verification.
- **Professional** — networking for hiring, funding, mentorship, collaboration.
- **Creator** — Spotlight-verified creator seeking collaborations/bookings, controlling fan access.
- **Event attendee** — opts into networking around a Spotlight event.
- **Moderator/Admin** — reviews verification, moderation queues, and safety cases.

## §5 Profile modes (§5.1 in scope / §5.2 out of scope)
### §5.1 In scope
Dating, Friendship, Professional, Creator, Event. Each mode has its own visibility toggle,
discoverability rules, and intent tags. A user can enable any subset.

### §5.2 Out of scope (hard "Must Not Have" — never implement)
Escort/adult services, paid companionship, sugar-dating framing, off-platform payment solicitation,
crypto/loan/gift-card requests, exact-location sharing by default, messaging before mutual match,
under-18 mode, unmoderated public media.

## §6 Compliance & safety posture
See `compliance.md` for the full invariant→control mapping. Headlines: 18+ hard age gate;
encrypted verification data with retention; approximate location until trust threshold + opt-in;
no pre-match messaging; AI moderation with stored reason codes; every report creates a case;
every admin action audited.

## §7 Phased delivery (maps to `BUILD-PLAN.md`)
- **Phase 0** — Foundation: safety/config backbone (feature flags, audit, case scaffold, age-gate,
  verification-data encryption hooks), module skeletons. *No feature screens.* → `PHASE-0-PLAN.md`.
- **Phase 1** — Core Dating & Friendship MVP (onboarding+age gate, profile modes, L0–L1
  verification, curated discovery, mutual match, safe chat, safety center, basic date planner,
  admin core).
- **Phase 2** — Professional networking.
- **Phase 3** — Event networking (reuse existing Spotlight `events` schema).
- **Phase 4** — Creator networking (reuse Spotlight creator verification).
- **Phase 5** — AI & trust expansion (profile coach, conversation assistant, scam-shield, circles).
- **Phase 6** — Monetization & ecosystem (premium tiers, boosts, Paymax rides/tickets in planner).

Each phase is built as **vertical slices** (DB migration → backend module → API → mobile → admin →
tests), each ending in a verify step against `acceptance.md`.

## §8 Success / acceptance
A phase is done only when its slice list in `acceptance.md` passes and **no safety invariant was
weakened to ship**. Definition of done per feature is in `dating/CLAUDE.md §63`.
