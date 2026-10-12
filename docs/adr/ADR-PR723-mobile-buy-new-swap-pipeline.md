# ADR-PR723: Mobile crypto BUY on the provider swap pipeline — client flag, PIN forwarded, poll-to-terminal

Status: accepted (flag-off)

## Context
The provider-driven buy swap pipeline (ADR-PR708/709/710/716/719) is mounted on the backend but nothing
consumes it. The React Native buy flow still calls the legacy synchronous `POST /crypto/orders/buy`, runs
against in-memory mocks by default, and renders a PIN card that is validated for length only and **never
sent** — so the pipeline's required second factor, its two-step quote→confirm model, and the reconciler's
`needs_review` parked state have no client. This ADR covers repointing mobile buy onto that pipeline.

## Decision
- **Client flag, independent of the backend's.** `EXPO_PUBLIC_CRYPTO_SWAPS` (default off) switches the buy
  flow between the legacy client-quote path and the new pipeline. The whole crypto surface already sits behind
  `invest_crypto`; the Go backend independently gates `FEATURE_CRYPTO_SWAPS_ENABLED`. No flag change ships on.
- **Pure money-path core, unit-tested.** `swapPipeline.ts` holds the logic that carries risk — a quote-body
  builder that **fails closed** (a non-safe-integer, zero or negative kobo amount throws before it reaches the
  wire), a snake_case→camel normaliser that keeps NGN as integer kobo, carries crypto amounts (quoted/
  received/price) **verbatim as decimal strings** with no float round-trip, and never recomputes the server's
  totals; a status→UX-stage classifier; and an error mapper that surfaces only the stable machine code. It has
  no runtime imports (types only), so it is tested directly under `node --test` (new `test:crypto` script).
- **Quote → confirm on the review screen; poll on processing.** The review screen creates the server quote
  (gets the swap id, renders authoritative numbers, counts down on the server `expires_at`) and, on confirm,
  calls `POST /swaps/:id/confirm` with the PIN. It then navigates to the processing screen with **only the
  swap id**, which polls `GET /swaps/:id` until terminal. The PIN therefore never travels through a
  navigation param (which becomes a URL query on react-native-web), header, query string or log — it exists
  only in the review component's memory and the confirm JSON body.
- **No double-submit.** The confirm button is disabled while the mutation is in flight; success navigates away,
  so confirm cannot fire twice. Each quote attempt uses a fresh Idempotency-Key; confirm carries no
  Idempotency-Key because it is idempotent by swap id per the contract.
- **`needs_review` is its own terminal screen.** A confirm that returns HTTP 202 (or a poll that lands on
  `needs_review`) routes to `buy/pending`, which tells the user the purchase is being confirmed and their NGN
  is **held** — never that it succeeded or failed. `expired`/`failed` route to `buy/failed` (funds released);
  `completed` routes to `buy/success` with the server's received amount.
- **Legacy path untouched.** With the flag off, the existing `buildQuote` + `/crypto/orders/buy` flow renders
  and behaves exactly as before; the two paths are isolated behind a dispatcher component.

## Known and deferred
- **Crypto-basis entry is estimated client-side.** The pipeline quote takes `ngn_kobo` only, so a
  "buy X coin" entry is converted to NGN from the indicative price before quoting. The server re-prices from
  that kobo amount and remains authoritative on the crypto received; the estimate only seeds the amount.
- **Mobile typecheck/ESLint not run locally.** This worktree has no installed mobile `node_modules`; the pure
  tests run without them, but `npm run typecheck` and lint must be confirmed in CI.
- **Sell and swap flows still legacy.** Only BUY is repointed here; crypto-to-crypto swap and sell remain on
  the legacy endpoints.

## Not decided here
The admin surface for `needs_review` swaps, repointing sell/swap, biometric step-up, and a client-side
per-user rate limit.
