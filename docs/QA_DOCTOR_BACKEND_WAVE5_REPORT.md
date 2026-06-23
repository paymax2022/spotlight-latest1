# QA / Go + AI-Safety Review — Doctor Backend **Wave 5** (AI-assist + `integrations/llm`)

**Reviewer:** QA/Go + AI-safety reviewer (static only)
**Date:** 2026-06-22
**Module:** `spotlight/backend` — `internal/doctor` (AI-assist) + new `internal/integrations/llm`
**Method:** STATIC review only. **No Go toolchain, no network, no execution.** All line cites are byte-accurate against the tree at review time. Compile/vet/test must still be run in CI (command at the end).

---

## 1. Summary verdict

**PASS — ship-ready.** Wave 5 is clean. Compile-shape resolves, the `aiGenerator` interface is satisfied exactly by `*llm.Client`, no duplicate symbols, routes match OpenAPI, the envelope matches the mobile TS contract field-for-field, and — the headline — **every AI-safety check (a–f) PASSES**. The disclaimer is present on every return path including disabled/error, no medical content is fabricated on any failure path, and the API key never leaves the `llm` package except as the outbound `x-api-key` header.

| Severity | Count |
|---|---|
| BLOCKER | **0** |
| MAJOR | **0** |
| MINOR | **2** (informational; not defects) |

---

## 2. Compile-shape + interface-satisfaction

### Handler -> Service call resolution

| Handler call (`handler_ai.go`) | Resolves to (`service_ai.go`) | OK |
|---|---|---|
| `h.ai.GenerateNoteSummary(ctx, uid, h.idemKey(c), raw)` (`:43`) | `(*AIService).GenerateNoteSummary` (`:116`) | OK |
| `h.ai.AcceptNoteSummary(...)` (`:62`) | `(*AIService).AcceptNoteSummary` (`:143`) | OK |
| `h.ai.CheckPrescriptionSafety(...)` (`:81`) | `(*AIService).CheckPrescriptionSafety` (`:177`) | OK |
| `h.ai.ExplainLabResult(...)` (`:100`) | `(*AIService).ExplainLabResult` (`:202`) | OK |

### Reused helpers (via embedded `*Handler`) — exist, not redeclared

| Helper | Defined | OK |
|---|---|---|
| `userID` | `handler.go:21` | OK |
| `fail` | `handler.go:32` | OK (renders `ErrIdempotencyRequired`/`ErrInvalidAmount` as **400**, `handler.go:40`) |
| `idemKey` | `handler.go:47` | OK |
| `rawBody` | `handler_account.go:21` | OK |
| `derefStr` | `service.go:225` | OK |
| `SaveNote` | `service.go:128` -> `repo.InsertNote` | OK |
| `GetLabResult(ctx, userID, orderID)` | `service.go:87` — call site `service_ai.go:213` passes `(ctx, userID, *in.ResultID)` | OK signature match |
| `ErrIdempotencyRequired`, `ErrInvalidAmount` | `service.go:40-41` | OK |

`AIHandler` embeds `*Handler` (`handler_ai.go:23`) so `userID/fail/idemKey/rawBody` are promoted; `AIService` composes `*Service` (`service_ai.go:36`) for `SaveNote`/`GetLabResult`. No helper is redeclared.

### Interface satisfaction — `aiGenerator` <- `*llm.Client`

`aiGenerator` (`service_ai.go:27-30`):
```go
type aiGenerator interface {
    Enabled() bool
    GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)
}
```
`*llm.Client` method set:
- `func (c *Client) Enabled() bool` (`anthropic.go:57`) — **exact match**
- `func (c *Client) GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)` (`anthropic.go:92`) — **exact match** (receiver `*Client`, param/return types identical)
- `func (c *Client) Model() string` (`anthropic.go:61`) — extra method, allowed.

**Interface satisfied exactly.** `NewAnthropicClient` returns `*Client` (`anthropic.go:46`), and `NewAIService(doctorSvc, llmClient)` accepts it via the `aiGenerator` param (`finance_routes.go:754`).

### Construction in `finance_routes.go` (in-scope deps)
- `llm` imported (`finance_routes.go:13`).
- Inside `if cfg.FeatureDoctorEnabled {` (`:747`): `doctorSvc` (`:751`), `doctorHandler` (`:752`) built, then `llmClient := llm.NewAnthropicClient(cfg.AnthropicAPIKey)` (`:753`) and `doctorAIHandler := doctor.NewAIHandler(doctorHandler, doctor.NewAIService(doctorSvc, llmClient))` (`:754`). All deps in scope.

### Braces / imports
Braces balanced in all four new files (23/23, 11/11, 38/38, 19/19). All imports used.

**Compile-shape: PASS — no unresolved calls, no interface mismatch.**

---

## 3. Duplicate-symbol sweep

`doctor` package + new `llm` package: top-level func/method/type/const/var — **no duplicates** (empty `uniq -d`). All new symbols unique. **PASS — empty.**

---

## 4. Route wiring + Gin

| Route (`finance_routes.go`) | Handler | OpenAPI POST | OK |
|---|---|---|---|
| `POST /ai/note-summary` (`:1041`) | `GenerateNoteSummary` | `doctor.openapi.yaml:1022` | OK |
| `POST /ai/note-summary/accept` (`:1042`) | `AcceptNoteSummary` | `:1029` | OK |
| `POST /ai/rx-safety` (`:1043`) | `CheckPrescriptionSafety` | `:1042` | OK |
| `POST /ai/lab-explanation` (`:1044`) | `ExplainLabResult` | `:1055` | OK |

- Paths match OpenAPI POST operations exactly. (Spec also lists GET-by-id replay variants `/ai/rx-safety/{id}`, `/ai/lab-explanation/{resultId}`, `/ai/note-summary/{appointmentId}` — read-cache endpoints, intentionally not implemented this wave; generate-on-demand has no persisted artifact to fetch.)
- All static paths under `/api/v1/doctor` — **no gin param-collision risk**; no duplicate method+path.
- All four sit inside the auth'd `docGroup` (`docGroup.Use(middleware.RequireAuthContext(supabase, rbac))`, `:757`) and the `FeatureDoctorEnabled` flag (`:747`).

---

## 5. AI-SAFETY review (the headline) — a–f

### (a) DISCLAIMER on EVERY envelope — **PASS**
Constant (`model_ai.go:43`):
```
const AiDisclaimer = "AI-generated draft for decision support only. It is NOT a diagnosis, " +
  "treatment decision, or medical advice, and may be incomplete or incorrect. " +
  "A licensed clinician must independently review and verify every detail before acting."
```
Both envelope builders set it unconditionally:
- `errorEnvelope` (`service_ai.go:93-99`): `Disclaimer: AiDisclaimer` on the **error** path.
- `readyEnvelope` (`service_ai.go:102-110`): `Disclaimer: AiDisclaimer` on the **ready** path.

Every generate method returns through exactly one of these two builders on every branch (disabled, gen-error, parse-error, success). No return site emits a bare/zero `AiEnvelope`. The accept path returns `AcceptAiNoteSummaryResult` (a persistence ack, not an AI draft).

### (b) DISABLED FALLBACK — no fabricated Output — **PASS**
Each generate method checks `!a.gen.Enabled()` first and returns `errorEnvelope(AiNotConfiguredMessage)`:
- `GenerateNoteSummary` (`service_ai.go:120-122`)
- `CheckPrescriptionSafety` (`service_ai.go:181-183`)
- `ExplainLabResult` (`service_ai.go:206-208`)

`errorEnvelope` leaves `Output` at zero (`nil`) — never assigned (`service_ai.go:93-99`), field is `omitempty` (`model_ai.go:65`) so omitted from JSON. Message: `"AI assist is not configured on this server. No AI draft was generated."` (`model_ai.go:48`). **No findings/diagnoses invented when key absent.**

### (c) LLM / PARSE FAILURE — no fabricated output — **PASS**
On `GenerateJSON` error -> `errorEnvelope("Failed to ...: " + err.Error())` (`:133-135`, `:194-196`, `:227-229`). On `json.Unmarshal` failure -> `errorEnvelope("AI returned an unparseable ...")` (`:140-141`, `:199-200`, `:232-233`). Both -> `Output` stays `nil`. **No partial/fabricated content on any LLM or parse failure.**

### (d) KEY HANDLING — **PASS**
- Read from cfg only: `config.go:189` `getEnv("ANTHROPIC_API_KEY", "")`, stored on `Config.AnthropicAPIKey` (`config.go:97`); passed once into `NewAnthropicClient(cfg.AnthropicAPIKey)` (`finance_routes.go:753`).
- Stored unexported: `Client.apiKey string` (`anthropic.go:38`).
- Used **only** as the request header: `httpReq.Header.Set("x-api-key", c.apiKey)` (`anthropic.go:115`) and to compute `Enabled()` (`anthropic.go:57`).
- **Never** in any returned struct, response body, or log. The non-200 error embeds the *response body* only (`anthropic.go:139`), which does not contain the key. Client-facing label is the public string `AiModelLabel = "Spotlight Care AI (Claude)"` (`model_ai.go:38`). **No leak path.**

### (e) PROMPT framing — **PASS**
`aiPromptPreamble` (`service_ai.go:53-57`): frames output as a DRAFT for a licensed clinician to review (NOT diagnosis/treatment/advice), instructs conservatism, "explicitly flag any uncertainty", "Do not invent patient data you were not given", and "Respond with ONLY a single valid JSON object ... no prose, no markdown, no code fences." Each endpoint appends task + typed JSON schema (`:59-90`). Rx-safety adds fail-safe: "Set safeToIssue=false if any critical finding exists" (`:186-187`).

### (f) SCOPING / AUTH — **PASS**
- All four handlers call `h.userID(c)` first and abort 401 if absent (`handler_ai.go:36,55,74,93`); `userID` resolves the authed doctor from JWT (`handler.go:21-29`).
- Group auth'd + feature-flagged (Section 4).
- Inputs scoped to authed doctor: `userID` threaded into `SaveNote(ctx, userID, ...)` on accept (`service_ai.go:170`) and `GetLabResult(ctx, userID, *in.ResultID)` on lab enrichment (`service_ai.go:213`) — both repo methods filter by the doctor's own rows. Generate endpoints persist nothing.

**AI-SAFETY verdict: a PASS, b PASS, c PASS, d PASS, e PASS, f PASS — all six PASS.**

---

## 6. Envelope parity (Go <-> `doctor.phase3.ts`)

`AiEnvelope` (`model_ai.go:58-69`) vs TS `AiEnvelope<T>` (`doctor.phase3.ts:294-305`):

| Field | Go json tag | TS | OK |
|---|---|---|---|
| status | `status` | `status` | OK |
| model | `model` | `model` | OK |
| generatedAt | `generatedAt,omitempty` | `generatedAt?` | OK |
| confidence | `confidence,omitempty` (`*int`) | `confidence?` | OK |
| disclaimer | `disclaimer` | `disclaimer` | OK |
| output | `output,omitempty` | `output?` | OK |
| accepted | `accepted` | `accepted` | OK |
| edited | `edited` | `edited` | OK |
| errorMessage | `errorMessage,omitempty` | `errorMessage?` | OK |

`AiStatus` consts `idle/generating/ready/error` (`model_ai.go:24-29`) = TS union (`:292`). Output structs match exactly:
- `AiNoteSummaryOutput` subjective/objective/assessment/plan/diagnosis[]/keyPoints[] (`model_ai.go:73-80` <-> `ts:310-317`)
- `AiSafetyFinding` + `AiSafetyOutput` (`model_ai.go:83-105` <-> `ts:332-348`)
- `AiLabFlagExplanation` + `AiLabExplanationOutput` (`model_ai.go:108-126` <-> `ts:353-365`)
- `AcceptAiNoteSummaryResult` noteId/accepted (`model_ai.go:131-134` <-> `ts:508-511`)

**Envelope + output parity: PASS.**

---

## 7. LLM client correctness (`anthropic.go`)

| Check | Found | OK |
|---|---|---|
| Endpoint | `https://api.anthropic.com/v1/messages` (`:25`) | OK |
| Header `x-api-key` | `:115` | OK |
| Header `anthropic-version: 2023-06-01` | `:116` (const `:26`) | OK |
| Header `content-type: application/json` | `:117` | OK |
| Request body | `model` + `max_tokens` + `system` + `messages[{role,content}]` (`:64-75`, marshalled `:101`) | OK |
| Parse `content[0].text` | `:144-150` | OK |
| Validate JSON | `json.Valid([]byte(text))` else error (`:152-155`) | OK |
| Non-200 -> error | `StatusCode < 200 \|\| >= 300` (`:137-140`) | OK |
| Timeout | `http.Client{Timeout: 30s}` (`:30,:50`) + `NewRequestWithContext` (`:111`) | OK |
| Empty content -> error | `len==0 \|\| Text==""` (`:147-149`) | OK |
| Disabled guard | `if !c.Enabled()` (`:93-95`) | OK |

Model is `claude-3-5-sonnet-latest` (`:27`) — valid alias. No wrong header/field. **LLM client: PASS.**

---

## 8. Additive scope

- New files only: `integrations/llm/anthropic.go`, `doctor/{model_ai.go, service_ai.go, handler_ai.go}`. Edited: `config/config.go` (+`AnthropicAPIKey`), `app/finance_routes.go` (import + construction + 4 routes). Matches declared scope.
- **No migration added** for Wave 5 (newest migration `20260626000100_maps_core.sql`, unrelated). Generate endpoints persist nothing; accept reuses existing `SaveNote -> InsertNote -> doctor_clinical_notes` path.
- `NewService`/`NewHandler` unchanged; `NewAIService`/`NewAIHandler` purely additive.
- No AI routes left in `routes_remaining.go` (grep empty) — no double-wiring.

---

## COVERAGE UPDATE

- Inventory: **309** live endpoints (`mobile-app/reactnative/docs/DOCTOR_ENDPOINT_INVENTORY.md`).
- Doctor routes wired in `finance_routes.go`: **225** (221 + 4 new AI).
- **Implemented / total ~ 225 / 309 ~ 73%** of inventory (up from 221/309 ~ 72% at end of Wave 4).

**Updated deferred list** (AI assist now DONE — removed):
1. **Realtime WS / presence push** (chat + call live channels) — persistence shipped, transport deferred.
2. **Agora/VideoSDK token issuance** — placeholder persisted; adapter pending.
3. AI read-replay GET variants (`/ai/rx-safety/{id}`, `/ai/lab-explanation/{resultId}`, `/ai/note-summary/{appointmentId}`) — optional, no persisted artifact, low priority.
4. Long-tail (~84) inventory endpoints across emergency/escalation, advanced records sharing, compliance/training tails, and remaining vet/pet long-tail mapping 1:1 onto existing `doctor_*` tables (no migration needed).

---

## Defect list (describe — do NOT apply)

**BLOCKER:** none.
**MAJOR:** none.

**MINOR / informational**

- **M1 (cosmetic) — unused `userID` param in two generate methods.** `GenerateNoteSummary` (`service_ai.go:116`) and `CheckPrescriptionSafety` (`:177`) accept `userID` but do not use it (only `ExplainLabResult` uses it, for `GetLabResult`). This is a **function parameter**, so Go does **not** error (unlike an unused local var) — `go vet`/`go build` stay green. Kept for signature symmetry. Not a defect.

- **M2 (forward-looking) — generate endpoints have no per-doctor rate limit / cost guard.** Each call hits the paid Anthropic API with `max_tokens: 2048`. Auth + feature-flag gate access, but there is no throttle. Out of scope for static correctness; recommend a token/req budget per doctor before GA. Not a Wave-5 defect.

---

## Run in CI (the toolchain this review could NOT run)

```
cd backend && go build ./... \
  && go vet ./internal/doctor/... ./internal/integrations/llm/... \
  && go test ./internal/doctor/...
```

**No-toolchain caveat:** this was a **static** review — no `go build`, `go vet`, `go test`, or network call executed. Method-set satisfaction, type inference, and import resolution were verified by reading source; the CI command above is the authoritative gate. (`backend/tests/` has no test framework configured, so `go test ./internal/doctor/...` will report "no test files" rather than fail.)
