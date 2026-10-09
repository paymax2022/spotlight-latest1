# Runbook — Restaurant Paystack-funded checkout (card/bank-transfer food orders)

> Audience: on-call / release engineer. The food card-checkout rail is fully
> built but **unmounted in every environment** — `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED`
> is unset everywhere and defaults OFF. This is deliberate, not a bug: the rail
> is the audited wallet-free payment path (a direct Paystack charge escrowed via
> `settlement.EscrowExternal`), and the flag is its kill switch.

## What the rail is

A customer pays for a food order by card/bank-transfer directly through
Paystack — **no wallet debit, so no KYC-tier gate** (the wallet-funded
`PlaceOrder` tier gate stays fail-closed regardless). This is the accepted
alternative to the rejected `FEATURE_CHECKOUT_TOPUP_TIER0` top-up-then-spend
design — see `docs/audit/checkout-allowance-audit-findings.md`.

Money shape (iron-rule compliant):

- `POST /api/finance/restaurant/:id/orders/paystack/initiate` requires an
  `Idempotency-Key` header, freezes the server-quoted amount (integer kobo)
  into `restaurant_order_paystack_intents` (migration
  `20270306000000_restaurant_order_paystack_intents.sql`), and returns a Paystack
  `authorization_url` + `foodorder:`-prefixed reference.
- Confirmation happens two ways, both landing on
  `paystackcheckout.Service.OnChargeSuccess`:
  1. the shared Paystack webhook `POST /api/webhooks/paystack/go` routes any
     `charge.success` whose reference carries the `foodorder:` prefix
     (`webhooks.RestaurantOrderReferencePrefix`) to the injected
     `RestaurantOrderConfirmer`;
  2. `GET /api/finance/restaurant/orders/paystack/:reference/status` polls and
     **self-heals** — it independently verifies the charge with Paystack, so an
     order still places even if the webhook never arrives.
- On confirmed charge the service calls `PlaceOrderPaystackFunded`, which posts
  balanced escrow legs (`settlement.EscrowExternal`) and then runs the normal
  order lifecycle. `amount_mismatch` and post-verify failures auto-refund via
  `RefundPayment` (the reason the concrete `*paystack.Client`, not the
  `PaymentProvider` interface, is threaded through).

Code: `backend/internal/restaurant/paystackcheckout/` (service, handler,
intent store), wired in `backend/internal/app/finance_routes.go:1734`.

## Enablement checklist (all required — the gate is ANDed)

| Layer | Setting | Effect if missing |
|---|---|---|
| Go env | `PAYSTACK_SECRET_KEY=sk_…` (real key, non-placeholder) | `paystackClient` is nil → routes never mounted, flag ignored |
| Go env | `FEATURE_RESTAURANT_ENABLED=true` | whole `restGroup` unmounted |
| Go env | `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED=true` | initiate/status routes + webhook confirmer not wired |
| frontend-web env | `FEATURE_RESTAURANT_ENABLED=true` | BFF `/api/v1/restaurant/**` 503s |
| frontend-web env | `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED=true` | BFF `/api/v1/restaurant/[id]/orders/paystack/initiate` 503s (`featureFlags.restaurantPaystackCheckout`) |
| Paystack dashboard | webhook URL → `https://<api-host>/api/webhooks/paystack/go`, `charge.success` enabled | orders still place via the status poll's self-heal, but slower (customer must reach the status screen) |

Notes:

- Webhook signature verification uses `PAYSTACK_SECRET_KEY` itself
  (HMAC-SHA512 — Paystack has no separate webhook secret; `PAYSTACK_WEBHOOK_SECRET`
  is read but unused, see `docs/ENV.md`).
- Both flags are read **at process start** — a Go restart and a Next.js restart
  are required after changing them (`docs/runbooks/feature-flag-disable.md`).
- In `APP_ENV=production`, `config.Validate()` fails boot if
  `PAYSTACK_SECRET_KEY` is missing/placeholder while a payment feature is on.
- The mobile client (`EXPO_PUBLIC_API_BASE_URL` → Go `/api/finance/restaurant`)
  bypasses the BFF for the initiate call, so the Go flag alone unblocks mobile;
  the BFF flag gates the web proxy surface. There is no client-side flag —
  `app/food/checkout.tsx` always offers "Pay with Card/Transfer" and the
  503 surfaces as the card-option error when the rail is dark.

## Local e2e against the Paystack fake

The `tools/fakes` service also exposes the `api.paystack.co` surface the
provider client calls (`/transaction/initialize`, `/transaction/verify/{ref}`,
`/refund`), so the whole rail runs locally with no real keys:

- Backend env: `PAYSTACK_SECRET_KEY=<shared dev secret>` (any `sk_…` value —
  the fake signs webhooks with the same value),
  `PAYSTACK_BASE_URL=http://localhost:9100`, plus the two restaurant flags.
  `PAYSTACK_BASE_URL` is dev-only — `config.Validate()` fails boot if it is set
  outside development.
- Fake env: `PAYSTACK_SECRET_KEY=<same secret>`,
  `PAYSTACK_FAKE_WEBHOOK_URL=http://localhost:<api-port>/api/webhooks/paystack/go`
  (leave unset to exercise only the status-poll self-heal).
- Drive it: initiate → `POST /_paystack/complete {"reference":"foodorder:…"}`
  flips the charge to `success` and fires a signed `charge.success`;
  `{"webhook":false}` skips the delivery so `GET …/status` self-heals instead.
  An un-completed charge verifies `pending`, so the unpaid fail-closed path is
  real; `POST /refund` is what the amount-mismatch/order-failed reversals hit.

## Test plan after enabling

Unit/integration (no flag needed — they construct the service directly):

- `cd backend && go test ./internal/restaurant/paystackcheckout/... -count=1`
- `cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres go test ./internal/restaurant/ -run 'Paystack' -count=1`
  (`paystackfunded_*` invariant + live-DB suites: escrow legs, amount-mismatch
  refund, idempotent replay)

Manual smoke (staging, Paystack test keys `sk_test_…`/`pk_test_…`):

1. `POST /api/v1/restaurant/<id>/orders/paystack/initiate` with
   `Idempotency-Key: w10-food-<n>` and a normal order body → expect 200 +
   `authorizationUrl` + `reference` starting `foodorder:`.
2. Replay the same request with the same key → same reference, no second charge.
3. Complete the charge with a Paystack test card →
   `GET …/orders/paystack/<reference>/status` → `confirmed` + `orderId`; the
   order appears in `GET /api/v1/restaurant/orders?role=customer`.
4. Verify escrow legs: `restaurant_order_paystack_intents.status='confirmed'`
   and the settlement row exists for the order.
5. Webhook path: send a test `charge.success` from the Paystack dashboard (or
   confirm the real webhook arrived) — order places without the status poll.
6. Kill-switch check: set the Go flag off, restart → initiate 404s; BFF flag
   off → `/api/v1` initiate 503s.

## Template status

`FEATURE_RESTAURANT_ENABLED` / `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED`
are in `backend/.env.example` (both `=false`). The latter remains absent from
`frontend-web/.env.example` (only `FEATURE_RESTAURANT_ENABLED=false` is there)
— templates stay OFF by rule; adding the BFF flag's `=false` placeholder is a
frontend-web lane change, not done here.
