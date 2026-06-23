# QA Report — Doctor Backend, WAVE 6 (realtime: RTC token issuance + WebSocket push)

**Reviewer:** QA / Go + security (static).
**Scope:** Wave 6 realtime layer — `backend/internal/integrations/rtc/{agora.go, videosdk.go, rtc.go}` (new); edits to `config/config.go`, `doctor/{service.go, service_ops.go, model_ops.go, handler_ops.go, handler.go}`, `app/finance_routes.go`, `contracts/doctor.openapi.yaml`. Plus the FINAL doctor-backend completeness summary.

> **No-toolchain caveat:** This was a **static** review. No `go build`, `go vet`, `go test`, or network call was executed (no Go toolchain in this environment). Findings are from source reading: symbol sweeps (receiver-aware), signature cross-matching, brace/import accounting, scope/shadow analysis, secret-flow grepping, route-table modeling, and OpenAPI diffing. The CI command at the end is the authoritative gate.

---

## Verdict

**APPROVE (static).** Wave 6 is a clean, additive realtime layer. Compile-shape is sound, the dup-symbol sweep is empty, RTC secrets never leave the server, the disabled-fallback never fabricates a token, the WS endpoint is auth-gated and best-effort, the two new routes are unique/static, and the new struct fields are transient (not DB-scanned). **One known-risk NOTE** (not a blocker): the Agora AccessToken2 byte format is the implementer's own stdlib re-implementation and carries an explicit "VERIFY against official builder" comment — it MUST be validated against a known-good vector before live Agora is enabled. VideoSDK (the high-confidence fallback) is correct.

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 0 |
| MINOR / NOTE | 2 (N1 Agora token unverified vector; N2 VideoSDK `version:2` claim) |

---

## 1. Compile-shape + the `rtc` field/package shadow finding

| Check | Result | Evidence |
|---|---|---|
| `NewService` signature preserved (db, ledger, tiers, redis) | **PASS** | `service.go:38` — unchanged; returns `&Service{...}` without rtc/hub. |
| `WithRealtime(issuer, hub) *Service` additive (sets fields, returns receiver) | **PASS** | `service.go:45-49` (`s.rtc = issuer; s.hub = hub; return s`). |
| `NewHandler(svc) *Handler` signature preserved | **PASS** | `handler.go:22` — unchanged. |
| `WithHub(hub) *Handler` additive | **PASS** | `handler.go:25-28`. |
| finance_routes constructs Issuer + Hub from in-scope `cfg` and attaches | **PASS** | `finance_routes.go:770-779` — `rtc.NewIssuer(rtc.Config{...cfg.Agora*/cfg.VideoSDK*})`, `platformWS.New()`, `.WithRealtime(rtcIssuer, doctorHub)`, `.WithHub(doctorHub)`. |
| `hub.ServeHTTP(c.Writer, c.Request, uid)` matches hub.go | **PASS** | call `handler.go:45`; sig `hub.go:42` `ServeHTTP(w http.ResponseWriter, r *http.Request, userID string) error`. `gin.Context` exposes `c.Writer` (http.ResponseWriter) + `c.Request` (*http.Request). |
| `hub.SendToUser(userID, ws.Message{...})` matches hub.go | **PASS** | call `service_ops.go:56`; sig `hub.go:62` `SendToUser(userID string, msg Message)`. |
| `ws.Message{Type, Payload}` shape matches hub.go | **PASS** | struct `hub.go:13-16` `{Type string; Payload any}`; constructed `service_ops.go:56` `platformWS.Message{Type: eventType, Payload: payload}`. |
| `IssueCallToken` / `ServeWS` handlers resolve to methods | **PASS** | `handler_ops.go:98` `(*Handler).IssueCallToken` → `service_ops.go:239` `(*Service).IssueCallToken`; `handler.go:34` `(*Handler).ServeWS`. |
| Reused helpers not redeclared | **PASS** | `strOrDefault` only at `repository.go:896`; `deterministicAgoraUID` only at `service_ops.go:24`; `b64url` only at `videosdk.go:24`; `callTokenTTL` single `const` at `service_ops.go:17` (the "3 hits" are comment+decl+use). |
| Imports used; new imports resolve | **PASS** | service.go imports `integrations/rtc` + `platform/ws` (both used in struct/method); service_ops.go imports both (used `rtc.ProviderAgora`, `platformWS.Message`); handler.go imports `platform/ws` (used in field/WithHub/ServeWS); finance_routes imports both (`:14`, `:46`). |
| Braces balanced in edited files | **PASS** | All edited files parsed cleanly on read; method/struct blocks close. |

### The `rtc` field-vs-package shadow (explicitly verified)

The implementer flagged a possible collision: `Service` has a field named `rtc` of type `*rtc.Issuer` (`service.go:32`), while the package identifier `rtc` is also referenced in the same file set. **There is NO collision.** Quoting the lines:

- Field declaration: `service.go:32` — `rtc    *rtc.Issuer` — legal Go: the field name `rtc` and the type `*rtc.Issuer` (package selector) coexist in a struct field declaration.
- Field access is **always** via the receiver selector `s.rtc`, never the bare identifier:
  - `service_ops.go:40` — `if s.rtc == nil || !s.rtc.Enabled(provider) {`
  - `service_ops.go:43` — `tok, exp, err := s.rtc.Token(provider, appointmentID, uid, callTokenTTL)`
- The bare package identifier `rtc.X` is used **only** in function bodies that declare **no** local/field-free `rtc` symbol:
  - `service_ops.go:217` — `provider := strOrDefault(p.Provider, rtc.ProviderAgora)` (inside `StartCallSession`)
  - `service_ops.go:244` — `provider := strOrDefault(sess.Provider, rtc.ProviderAgora)` (inside `IssueCallToken`)

In Go, a struct field never shadows a package name in selector-free scope; `s.rtc` is a selector expression bound to the receiver, and `rtc.ProviderAgora` is a separate selector bound to the imported package. The named return value `rtcConfigured` (`service_ops.go:38`) is a distinct identifier and also does not shadow `rtc`. **No body uses a bare `rtc` that could be ambiguous.** Shadow risk: **CLEARED.**

---

## 2. Dup-symbol sweep

- **doctor package** (receiver-type + name aware): **EMPTY** — 0 true duplicates. (A naive name-only sweep flags ~210 "dups" because methods like `GetCallSession` legitimately exist on both `*Service` and `*Handler`; once the receiver type is included in the key, the duplicate set is empty.)
- **rtc package:** **EMPTY** — `NewIssuer`, `(*Issuer).Enabled`, `(*Issuer).Token`, `BuildAgoraRTCToken`, `BuildVideoSDKToken`, `b64url`, `putString`/`putU16`/`putU32`/`packAgoraService`/`agoraSign`/`deterministicAgoraUID`(doctor)—all unique within their packages.
- New free funcs added this wave (`deterministicAgoraUID`, `pushDoctor`(method), `mergeCallDetail`, `annotateCallToken`, `issueCallToken`(method)) — no name clash with existing doctor symbols.

**Verdict: PASS (no duplicate declarations).**

---

## 3. RTC security

| Check | Result | Evidence |
|---|---|---|
| App Certificate + VideoSDK secret read from cfg only | **PASS** | `config.go:108-111` from env (`AGORA_APP_CERTIFICATE`, `VIDEOSDK_SECRET` at `config.go:213/215`); passed into Issuer at `finance_routes.go:772/774`. Only references outside `rtc`/`config` are the construction lines. |
| Stored unexported, used solely to sign | **PASS** | `rtc.Config` fields held in unexported `Issuer.cfg` (`rtc.go:41-44`); cert/secret used only as HMAC key (`agora.go:agoraSign` step-1 key = appCert; `videosdk.go:50` `hmac.New(sha256.New, []byte(secret))`). |
| NEVER in any response / log / returned struct | **PASS** | No secret field appears in `CallSession`, in any `json` tag, in any `log.`/`fmt.Print`, or in any returned value. The two `json.Marshal` calls in `videosdk.go:44/48` serialize the JWT **header** and **payload** — payload carries `apikey` (a public project identifier) but **NOT** the secret; the secret is used only as the HMAC key. App Certificate is never serialized. |
| Disabled-fallback returns empty token + rtcConfigured=false, never a fabricated token | **PASS** | `service_ops.go:39-46` `issueCallToken`: `if s.rtc == nil \|\| !s.rtc.Enabled(provider) { return "", uid, nil, false }`; on signer error/empty `if err != nil \|\| tok == "" { return "", uid, nil, false }`. Issuer layer mirrors this: `rtc.go:68-71` returns `("", time.Time{}, ErrRTCNotConfigured)`. `annotateCallToken` (`service_ops.go:91-94`) sets `RoomToken = nil` when token == "". OpenAPI documents the contract (`doctor.openapi.yaml:273`). |
| Token short-lived + re-minted, not persisted as a long-term secret | **PASS** | `callTokenTTL = time.Hour` (`service_ops.go:17`); `IssueCallToken` re-mints on demand with no idempotency (time-bound; `service_ops.go:236-247`). The **signed token is intentionally NOT stored** — only provider/uid/expiry are folded into `detail` (`mergeCallDetail`, `service_ops.go:60-80`; comment `service_ops.go:58-59`). The token returned in `RoomToken` is transient. |

**RTC security verdict: PASS on all five.** No secret leak path exists.

---

## 4. RTC correctness

### VideoSDK JWT (HS256) — **PASS (high confidence)**
`videosdk.go:30-58`:
- Header `{"alg":"HS256","typ":"JWT"}` — `:35`. ✔
- Payload has `apikey`, `permissions` (`["allow_join"]`), `iat`, `exp` (+`version:2`) — `:36-42`. ✔
- HMAC-SHA256 over `base64url(header).base64url(payload)` — `:50-52` (`hmac.New(sha256.New, secret)` over `signingInput`). ✔
- base64url **no padding** — `b64url` uses `base64.RawURLEncoding` (`:25`). ✔
- dot-joined `header.payload.sig` — `:54`. ✔
- Empty-creds guard returns `ErrVideoSDKMissingCreds` — `:32`. ✔

This matches VideoSDK's documented HS256 auth-token format. See N2 below (a minor confirm-against-docs note on `version:2`/`permissions`).

### Agora AccessToken2 ("007…") — **functional structure present; byte-format UNVERIFIED → known-risk NOTE (N1)**
`agora.go` implements the full AccessToken2 algorithm in stdlib (not a stub): version prefix `"007"` (`:55`), per-service privilege map (join + publish audio/video/data, `:87-101`), two-step HMAC seeded by the App Certificate (`agoraSign`, `:104-114`), packed signature + signed-content, zlib compress + base64 (`:142-156`). The required **explicit "VERIFY against official builder" comment IS present** — `agora.go:60-67`:

> "VERIFY against Agora AccessToken2 spec / official Go builder before prod. … the exact little-endian field widths and the precise ordering of the packed (vs. signed) sections should be cross-checked byte-for-byte against github.com/AgoraIO/Tools AccessToken2.go in CI with a known-good vector before enabling live Agora calls."

This is recorded as a **NOTE / known-risk, NOT a blocker**, because: (a) VideoSDK is the high-confidence fallback and the default path is gated; (b) Agora is **disabled unless creds are set** (`Enabled()` `rtc.go:50-52`), and when disabled the system returns an empty token + `rtcConfigured=false` rather than a bad token; (c) the implementer flagged it MEDIUM-confidence with an explicit verify gate.

**Known-risk statement (must appear in pre-prod checklist):** *The Agora AccessToken2 byte format in `agora.go` is a hand-rolled stdlib re-implementation and has NOT been validated against `github.com/AgoraIO/Tools` AccessToken2. Before enabling live Agora calls, it MUST be cross-checked byte-for-byte against the official builder using a known-good vector (same appID/cert/channel/uid/ts/salt → identical token). Until then, prefer VideoSDK; Agora tokens may be rejected by Agora's servers.* Specific items to validate: whether the signed content includes the appID as a uint16-length-prefixed string vs raw 32 bytes; the salt-vs-issueTs ordering; and whether Agora's signing seed derivation matches (`HMAC(appCert, issueTsBytes)` then `HMAC(key1, msg)`).

---

## 5. WebSocket

| Check | Result | Evidence |
|---|---|---|
| Endpoint resolves authed doctor before upgrade | **PASS** | `ServeWS` calls `h.userID(c)` first (`handler.go:35`); `userID` reads `middleware.GetAuthenticatedUser` and aborts 401 if absent (`handler.go:53-60`). Route is under the `RequireAuthContext`-protected `docGroup`. The upgrade (`hub.ServeHTTP`) runs only after a valid `uid`. |
| Push is best-effort / nil-hub safe / never fails the HTTP write | **PASS** | `pushDoctor` returns early on `s.hub == nil` (`service_ops.go:53-54`); `SendToUser` is fire-and-forget with a non-blocking `select{ default: drop }` (`hub.go:71-76`). Callers push **after** the REST write succeeds (`SendChatMessage` `service_ops.go:198`; `StartCallSession` `service_ops.go:230`) and ignore the (void) result. WS failure cannot affect persistence. |
| Events scoped to the doctor's own userID | **PASS** | `pushDoctor(userID, ...)` always passes the authed doctor's `uid`; `SendToUser` fans out only to `h.clients[userID]` (`hub.go:69`). `ServeWS` registers the connection keyed by the doctor's own `uid` (`handler.go:45`). No cross-user fan-out. |
| Message shape correct | **PASS** | `platformWS.Message{Type: eventType, Payload: payload}` (`service_ops.go:56`) matches `hub.go:13-16`. Event types: `"chat.message"`, `"call.ringing"`. |
| ServeWS when hub nil | **PASS** | Returns `503 {"error":"realtime not configured"}` (`handler.go:39-42`) rather than panicking. |

**WS verdict: PASS.**

---

## 6. Routing + OpenAPI

- **2 new routes**, both on `docGroup` (`/api/v1/doctor`):
  - `POST /calls/:appointmentId/token` → `doctorHandler.IssueCallToken` (`finance_routes.go:1037`)
  - `GET /ws` → `doctorHandler.ServeWS` (`finance_routes.go:1040`)
- **No duplicate method+path:** the method+path uniqueness sweep across all `docGroup.*` registrations returns EMPTY. `/calls/:appointmentId/token` is distinct from `/calls/:appointmentId`, `/calls/:appointmentId/join`, `/calls/:appointmentId/leave`. `/ws` is fully static.
- **No gin param-collision risk:** `/ws` is static; `/calls/:appointmentId/token` shares the `:appointmentId` param name consistently with its sibling call routes (gin requires same param name at the same position — satisfied).
- **OpenAPI additive:** `contracts/doctor.openapi.yaml` adds `/doctor/calls/{appointmentId}/token` (`:1444`) and `/doctor/ws` (`:1457`), and extends the `CallSession` schema (`:259`) with `roomToken` semantics (`:269`), `tokenUid` (`:271`), `tokenExpiresAt` (`:272`), `rtcConfigured` (`:273`). No paths removed/renamed.

**Routing + OpenAPI verdict: PASS.**

---

## 7. Additive scope

- **Files changed = only the listed set.** New: `integrations/rtc/{agora.go, videosdk.go, rtc.go}`. Edited: `config/config.go`, `doctor/{service.go, service_ops.go, model_ops.go, handler_ops.go, handler.go}`, `app/finance_routes.go`, `contracts/doctor.openapi.yaml`.
- **No new go.mod dependency.** `rtc` is stdlib-only (`crypto/hmac`, `crypto/sha256`, `crypto/rand`, `encoding/base64`, `encoding/binary`, `encoding/json`, `compress/zlib`, `bytes`, `errors`, `strings`, `time`). WS uses `nhooyr.io/websocket v1.8.17`, already in `backend/go.mod:48`.
- **No migration.** Token issuance + WS need no table. The new `CallSession` fields (`TokenUID`, `TokenExpiresAt`, `RTCConfigured`) are **transient response-only** — confirmed **NOT scanned from DB**: both `GetCallSessionForAppointment` (`repository_ops.go:152-156`) and `getCallSessionByID` (`repository_ops.go:167-171`) `Scan` exactly the 14 persisted columns (`id … updated_at`) and never the three Wave-6 fields. The model comment documents them as "transient, not persisted on the row" (`model_ops.go:82-91`).

**Additive scope verdict: PASS.**

## 8. Money
**N/A** — Wave 6 touches no ledger, no balance, no money path. (The pre-existing `RequestPayout` money path is unchanged.)

---

## FINAL COMPLETENESS SUMMARY — Doctor Backend

### Headline counts
- **Total `/api/v1/doctor` routes now registered: 227** (`finance_routes.go`, all on `docGroup` at `/api/v1/doctor`; verb mix: 128 GET, 84 POST, 13 PUT, 1 PATCH, 1 DELETE). Wave 5 ended at 225; Wave 6 adds the 2 realtime routes → **227**.
- **Inventory target:** `DOCTOR_ENDPOINT_INVENTORY.md` declares **309** live endpoints across 11 modules (`:375`).
- **Implemented / total ≈ 227 / 309 ≈ 73%.**
- **OpenAPI:** `contracts/doctor.openapi.yaml` carries all 227 implemented paths (additive); it also documents some not-yet-wired long-tail/replay variants (spec ⊇ implementation), which is the intended spec-first posture.

### Per-wave recap
| Wave | Theme | Routes (cumulative) |
|---|---|---|
| MVP | Money path (payouts, ledger, idempotency, tier limits) + core reads/writes | ~31 |
| Wave 2 | Account / provider / admin + payout-audit hardening | builds toward ~120 |
| Wave 3a | Clinical (notes, prescriptions, labs, follow-ups, referrals, HMO) | **146 total** at end of 3a |
| Wave 3b | Vet mode (`/vet/*`, pets `:petId`, ~15+ routes; no `:petId`/`:id` collision) | ~vet block appended |
| Wave 4 | Operational (chat persistence, call sessions CRUD, schedule mgmt, consult queue, appointment requests, HMO claims, clinics) | +27 |
| Wave 5 | AI assist (note-summary, rx-safety, lab-explanation via Anthropic) | +4 → **225** |
| Wave 6 | Realtime (RTC token issuance + WebSocket push) | +2 → **227** |

### Remaining deferred (~82 inventory endpoints) — and WHY
1. **AI read-replay GET variants** (`/ai/rx-safety/{id}`, `/ai/lab-explanation/{resultId}`, `/ai/note-summary/{appointmentId}`) — optional read-cache endpoints; generate-on-demand persists no artifact to fetch. Low priority.
2. **Realtime patient-side channel** — Wave 6 ships server→client push for the **doctor**; chat push to the **patient** and presence are still TODO (REST persistence works). The hub is single-instance (in-process); multi-instance fan-out via Redis pub/sub is noted as future work in `hub.go:28-30`.
3. **Long-tail (~82)** across emergency/escalation, advanced records sharing, compliance/training tails, and remaining vet/pet long-tail. Each maps 1:1 onto an existing `doctor_*` table — **no migration needed**, purely additional handler+route+service wiring. Deferred by sequencing, not by blockers.

### Overall readiness statement
The doctor backend is **statically sound and feature-flag-gated** (`cfg.FeatureDoctorEnabled`). The money path honors all iron rules; the realtime layer is additive, secret-safe, and fail-open on transport. **227/309 (~73%)** of the inventory is wired, with the remainder being low-risk long-tail/replay endpoints over existing tables. **One pre-prod gate remains: validate the Agora AccessToken2 token format against a known-good vector** (VideoSDK is correct and is the safe default).

### Single CI command to gate merge
```
cd backend && go build ./... \
  && go vet ./internal/doctor/... ./internal/integrations/... \
  && go test ./internal/doctor/...
```

### Explicit pre-prod must-dos
1. **Run the CI command on a real Go runner** (this review could not execute it).
2. **Validate Agora AccessToken2** byte format vs `github.com/AgoraIO/Tools` with a known-good vector before enabling live Agora; until then prefer VideoSDK.
3. **Set secrets** in the prod environment: `ANTHROPIC_API_KEY`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `VIDEOSDK_API_KEY`, `VIDEOSDK_SECRET` (empty creds correctly disable the provider).
4. **`supabase db push`** — confirm no pending doctor migrations are unapplied (Wave 6 adds none).
5. **Flip feature flags** (`FeatureDoctorEnabled`, plus telemedicine) only after 1–4.

---

## Defect list (describe — do NOT apply)

**BLOCKER:** none.
**MAJOR:** none.

**NOTE / known-risk**

- **N1 (known-risk, pre-prod gate) — Agora AccessToken2 byte format unverified.** `agora.go` is a hand-rolled stdlib AccessToken2 builder with an explicit "VERIFY against official builder" comment (`agora.go:60-67`). Not a blocker (Agora is disabled-unless-configured and falls back to empty token + `rtcConfigured=false`; VideoSDK is the high-confidence default). **Must** be validated against a known-good vector before live Agora. See §4.
- **N2 (minor, confirm-against-docs) — VideoSDK payload `version:2` + `permissions:["allow_join"]`.** The HS256 mechanics are textbook-correct; the only thing to confirm against current VideoSDK docs is the exact claim set (`version`, `permissions` vocabulary, and whether `roomId`/`participantId` scoping is desired). Functionally signs a valid token today; not a defect.

**Informational**
- The chat WS push is **doctor-scoped only** by design this wave; patient-side delivery remains a documented TODO (`service_ops.go:175-177`). Correct and intentional, not a defect.

---

## Run in CI (the toolchain this review could NOT run)
```
cd backend && go build ./... \
  && go vet ./internal/doctor/... ./internal/integrations/... \
  && go test ./internal/doctor/...
```
(`backend/tests/` has no test framework configured, so `go test ./internal/doctor/...` will report "no test files" rather than fail — `go build` + `go vet` are the real static gates.)
