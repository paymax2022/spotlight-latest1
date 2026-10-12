# ADR-PR731: Unwrap the Go named-key success envelope in the mobile crypto client

Status: accepted

## Context
The legacy Go crypto handlers (`backend/internal/crypto`) return `{ success: true, <namedKey>: payload }`
— `order`, `portfolio`, `holdings`, `assets`, `orders`, `asset`, `quote`, `points`, `transaction`, `swap`,
`addresses`, `address`, `deposit_address`, `screening`, `eligibility`, `withdrawal(s)`. The mobile client's
`unwrap()` only unwrapped a `data` key, so in a mockless build (staging/prod force mocks off) every non-buy
legacy path received the envelope `{ success, <key> }` instead of the payload. List callers then fell through
`Array.isArray(x) ? x : []` and silently rendered empty — a money-path display bug for sell/swap/withdraw/
portfolio. It was masked in dev because `USE_MOCK` returns raw payloads with no `success` flag.

## Decision
- A pure `unwrapEnvelope<T>(body)` (`src/features/crypto/utils/envelope.ts`) is the single place that knows the
  envelope shape:
  - `{ success: boolean, <oneKey>: payload }` → `payload` (the named-key case; `message` is ignored when
    choosing the key).
  - `{ success, data }` and a bare `{ data }` → `payload` (back-compat).
  - raw mock objects/arrays, primitives and `null` → returned unchanged (mocks have no `success` flag).
  - an envelope with **more than one** payload key (e.g. a future paginated `{ success, orders, next_cursor }`)
    → returned as-is, so the client never unwraps the wrong key; such a caller must extract explicitly.
- `crypto.api.ts`'s `unwrap()` delegates to it, fixing every call site at once with no per-call churn.
- The helper is pure (no runtime imports) so it is unit-tested directly under `node --test`.

## Why this shape, not a per-call named extractor
A per-call `unwrapKey(res, 'order')` at ~15 sites is more verbose and easy to get wrong one site at a time.
The single-payload-key heuristic is unambiguous for every current crypto response (all carry exactly one
payload key) and degrades safely (returns the body) if that ever stops being true, so the fix is both minimal
and forward-safe.

## Scope / not changed
- The new BUY swap pipeline (ADR-PR723 / cryptosvc) is untouched — it reads `body.swap` via its own
  `extractSwap` and never used `unwrap`.
- This only corrects client-side parsing; no backend or contract change. Live end-to-end verification of
  sell / swap / withdraw against the real backend is a separate follow-up (needs a running environment).
- The cross-module watchlist/alerts calls (invest endpoints) now also unwrap their named key; their remaining
  shape/id mismatches are tracked separately, not addressed here.
