# Association / Group-Membership module — status (done vs left)

_Last reconciled by audit of the codebase (not just notes)._

## Headline
- **Mobile app:** 69 screens across the full PRD member/admin/founder/governance surface — **complete & verified** (scoped `tsc` = 0 errors, no hardcoded design values, no duplicated primitives).
- **Contract:** `contracts/associations.openapi.yaml` — 68 paths / 76 operations / 70 schemas (valid).
- **DB:** `supabase/migrations/20260628000000_association_module.sql` — 29 additive `assoc_*` tables (incl. audit log).
- **Go backend:** `backend/internal/association/` — **72 routes wired** across 7 files; money path + all reads + mutations + settings/support/chat/ai-notes/join/import (incl. CSV bulk import) /publish; `committee_members` now real. **Statically audited, NOT compiled** (no Go toolchain in sandbox).
- **Live switch:** `EXPO_PUBLIC_ASSOCIATION_USE_MOCK` (default mock) — flip to go live once backend is compiled + path base reconciled.

## DONE — mobile (by PRD section)
| Section | Area | Status |
|---|---|---|
| B | Discovery, join (open/closed/paid), invite code, access code, QR scan, document upload, sub-steps (local branch, committee interest), submitted states | ✅ |
| C | Member profile dashboard, edit (+photo, DOB, emergency, next-of-kin), privacy, completion checklist, activity history | ✅ |
| D | Digital membership card (QR, suspended/dimmed) | ✅ |
| E | Member home dashboard (card, dues, meeting, announcement, tasks, quick-actions, role-gated admin entry) | ✅ |
| F | Member directory (search, status filter) + member detail (privacy-aware) | ✅ |
| G | Dues dashboard, payment (wallet/Paystack), revenue split, receipt | ✅ |
| H/Z | Edge/restriction states (payment-required, suspended, pending, rejected, offline, error, …) | ✅ |
| I | Group chat: inbox + thread (posting blocks, image attach, reactions, in-chat search, mute) | ✅ (UI; realtime/voice pending) |
| J/X | Announcements feed + detail + acknowledge; notification center | ✅ |
| K | Meetings dashboard + detail (RSVP, QR/manual check-in, agenda, minutes link) | ✅ |
| L | AI notes: dashboard, source picker, processing, review (approve→publish gate, convert→task, regenerate, export/share) | ✅ (UI; real capture/transcription pending) |
| M | Tasks: list + detail (checklist, comments, status progression) | ✅ |
| N | Committees: list + detail (join request) | ✅ |
| O | Events: list + detail (RSVP, paid registration → payment screen, ticket QR, check-in, feedback) | ✅ |
| P | Document vault: list + viewer (AI summary, versions, restricted, acknowledge) | ✅ |
| Q/R/S | Admin-lite: dashboard KPIs, approval queue + decision, finance + offline approvals, bulk import, member mgmt (suspend/restore/transfer/role), audit log, RBAC gating | ✅ |
| U | Organisation creation wizard (basics → branding → structure+chapters+committees → membership+dues → access/restrictions → review → publish) | ✅ |
| V | Settings: hub, notifications, security (password/biometric/2FA), devices, language, theme, logout/delete | ✅ |
| W | Support: help center/FAQ, tickets list/create/detail thread | ✅ |
| Y | Governance/elections — integrated with existing `/election` feature (payment-gated eligibility) | ✅ |

## DONE — backend / infra
- Money path: `PayInvoice` (idempotent ledger double-entry → settlement, revenue split, invoice PAID, audit), `GetReceipt`, `GetDues`.
- Reads wired: organisations, dashboard, card, profile, privacy, activity, admin-access, directory, member, announcements, notifications, meetings, tasks, documents, committees, events, admin kpis/approvals/finance/offline.
- Mutations wired: approval decision; announcement/document acknowledge; notifications read; meeting RSVP + check-in; task status; committee join; event RSVP/register/feedback; offline-payment decision; member suspend/restore/transfer/assign-role (all admin-gated + audit-logged).
- Config flag `FEATURE_ASSOCIATIONS_ENABLED`; routes mounted in `finance_routes.go`; revenue-split + idempotency unit tests.

## LEFT — prioritized
1. **Compile/test the Go package in CI** — `go build/vet/test ./internal/association/...` (blocked: no Go toolchain in sandbox). This is the one true gate; everything below is depth.
2. **Backend endpoints — now wired** (settings prefs/security/preferences/devices, support faqs/tickets/reply, chat threads/messages, AI-notes list/get/status/create/approve/publish/convert, join invite/access validate + apply, bulk import preview/confirm, org publish). **Done pending compile.** Remaining contract reconciliation: a few server paths differ from the OpenAPI to satisfy gin routing — org detail `GET /orgs/:id` (vs `/:id`), apply `POST /apply` (vs `/members/apply`); align the client base/proxy when going live.
3. **Go-live integration:** reconcile path base (Go `/api/v1/finance/associations` vs mobile bare `/associations`) via frontend-web proxy or client base; merge `associations.openapi.yaml` into shared `contracts/openapi.yaml`; apply both migrations (`20260628`, `20260629`); CI gates; then flip `EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false`.
4. **Backend depth:** ledger posting for approved offline payments; `ImportPreview` row parsing (CSV `BulkImportMembers` is wired at `POST /admin/import/members`; the preview-step endpoint still returns empty rows); chat unread/mute persistence + member counts; AI-notes real processing pipeline; real RBAC from `me/admin-access`; chapter-vs-national data scoping.  _(committee_members table + committee-join persistence: DONE by a concurrent change.)_
5. **Cross-module infra note (not association):** the migrations dir has duplicate version prefixes from other modules (`20260622000000`, `20260625000000`) that will block `supabase db push` until those teams renumber. The association module's own migrations (`20260628000000`, `20260629000000`, `20260629000100`) are collision-free.
5. **Mobile depth (native/3rd-party):** chat realtime (WebSocket) + voice notes + mentions; AI real audio capture/transcription/diarisation; real PDF export + native share; i18n/theming engine behind language/theme prefs; org-wizard logo upload + resume-after-close draft persistence; QR-scan camera + document upload to storage.

## Verification status
- Mobile: scoped `tsc -p tsconfig.assoccheck.json` → **0 errors**; hardcoded-hex grep → none.
- Backend: static audit only (braces balanced, all routed handlers + called service methods resolve, no duplicate symbols). **Needs `go build` in CI.**
- Contract: OpenAPI parses, 0 unresolved refs. Migration: additive-only verified.
