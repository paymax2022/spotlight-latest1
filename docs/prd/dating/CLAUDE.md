# CLAUDE.md — Paymax Connect

> This file is loaded into **every** Claude Code session. Keep it lean. It holds durable
> rules and guardrails only. The full specification is the PRD — read it for detail.

## What this is
Paymax Connect is a **trust-first, verified, 18+** dating / friendship / professional /
creator / event networking module **inside the existing Paymax + Spotlight super app**.
It is NOT a swipe-only dating clone. Core thesis: safer, more intentional connections that
move into real life. One user holds multiple **profile modes** (dating, friendship,
professional, creator, event), each with independent visibility.

## Canonical spec
- Full spec: `docs/paymax-connect-prd.md` — **source of truth**. Cite section numbers in PRs.
- This file overrides nothing in the PRD; it distills the rules that must hold in all code.

## Stack
- **Backend:** Go services; PostgreSQL + MongoDB hybrid; Redis; object storage; queue/event bus;
  dedicated AI safety service; Paymax wallet integration.
- **Mobile:** React Native (module lives under `apps/mobile/src/modules/connect`).
- **Admin:**  Nextjs admin dashboard (or existing Paymax admin console).
- **API:** versioned under `/api/v1/connect/...`.

## Repo layout (authoritative)
See PRD §26.2. Services under `/services/*`, mobile under `/apps/mobile`, admin under
`/apps/admin`, shared code under `/packages/*`. Do not invent parallel structures.

## NON-NEGOTIABLE SAFETY INVARIANTS (never weaken, in any phase)
1. **18+ only.** Hard age gate at onboarding; collect DOB; block and route suspected-minor
   accounts to the admin underage queue immediately. No teen/under-18 mode ever exists.
2. **No prohibited surfaces.** No escort/adult-service marketplace, paid companionship, or
   money/crypto/loan solicitation between users. See PRD §5.2, §24 "Must Not Have".
3. **Location privacy.** Never expose exact location by default; approximate only until a
   trust threshold and explicit user opt-in.
4. **No messaging before a mutual match** (except moderated, rate-limited intro/request flows).
5. **Verification data** is encrypted at rest with a defined retention policy; never logged.
6. **Every admin action is audited** (admin id, role, action, entity, old/new, reason, IP, ts).
7. **Every safety report creates a case**; report/block/unmatch flows must never fail silently.
8. **Every AI moderation decision stores reason codes** and is reviewable by authorized
   moderators only.
9. **Media is moderated before public visibility.**
10. **Financial-solicitation language triggers safety warnings** (money/gift-card/crypto/
    emergency-fund/off-platform-pressure scripts).
11. **Payments only via Paymax** wallet/payment infra; **entitlements validated server-side**.

## Architecture principles
- **Backend-controlled config, never hard-coded in mobile:** feature flags, matching weights,
  premium entitlements, moderation/safety rules, discovery limits, verification requirements.
  Mobile reads these from the backend.
- **Profile-mode separation:** one identity, N modes; per-mode visibility + privacy.
- **State machines** for verification, match, conversation-safety, case/incident, and
  subscription lifecycles. Reject illegal transitions; never mutate status ad hoc.
- **Object-level authorization** on every protected action (can THIS user/admin act on THIS
  record), not just route-level.
- **Idempotency + transactions** on all state-changing writes (matches, likes, payments, grants).

## Engineering conventions
- API: REST under `/api/v1/connect/*`; field-masked responses; clear per-field validation errors.
- Keys/secrets server-side only; never in the RN bundle. Parameterized queries only.
- Emit structured logs + metrics + an audit entry for every state change.
- Tests are part of "done" — especially state machines, authz, and safety flows.

## Definition of done (every feature)
- [ ] Matches PRD spec for the screens/endpoints in scope (cite §)
- [ ] Safety invariants above upheld; no invariant weakened to ship
- [ ] Config (flags/weights/rules/entitlements) read from backend, not hard-coded in mobile
- [ ] State changes go through guarded transitions; writes idempotent + transactional
- [ ] AuthN + object-level authZ on every endpoint
- [ ] Report/block/safety paths cannot fail silently; reports create cases
- [ ] Audit log written for admin + sensitive actions
- [ ] Tests cover state machine, authz, and the safety/abuse paths
- [ ] No secrets in client; parameterized queries

## How to work in this repo
1. **Investigate read-only first:** existing Paymax/Spotlight auth, wallet, events, admin,
   shared packages, and any existing `connect` code. Reuse; don't duplicate.
2. **Plan and confirm before coding:** list files/endpoints/migrations and the slice you'll build.
3. **Build vertical slices** (one feature end-to-end: service + API + mobile + admin + tests),
   not horizontal layers. Stay within the current phase's scope (see `BUILD-PLAN.md`).
4. **Verify against acceptance criteria** (PRD §27) before calling a slice done.
5. Never expand scope silently; never delete files without showing them first.

## Do NOT
- Build the whole app in one pass. Work one phase / one vertical slice at a time.
- Hard-code flags, weights, entitlements, or moderation rules in mobile.
- Implement anything in PRD §24 "MVP Must Not Have" or §5.2 "Out of Scope".
- Weaken any safety invariant for convenience or speed.
