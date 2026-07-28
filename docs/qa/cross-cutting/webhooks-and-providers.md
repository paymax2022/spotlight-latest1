# Cross-cutting: Webhooks & Provider Adapters

**Risk tier: 0.** Webhooks apply money-affecting state changes from providers; a forged or
replayed event that gets applied is an **S1** issue. Sources: `backend/internal/webhooks/`
(`paystack.go`, `monnify.go`, `maplerad.go`), `backend/internal/provider/**` (adapters +
`interfaces.go`/`ports.go`), FX orchestration adapters `backend/internal/orchestration/adapters/`,
web `frontend-web/app/api/webhooks/paystack/route.ts` (+ `gateway-handler.ts`,
`utility-handler.ts`) and `frontend-web/app/api/kyc/webhooks/[provider]/`.

## 1. Facts

- **Three distinct webhook surfaces:** (a) web Paystack webhook with two sub-handlers
  (gateway = contest/vote payments; utility = bills), (b) Go backend provider receivers
  (Paystack/Monnify/Maplerad), (c) the standalone trading backend `POST /crypto/webhooks/{provider}`.
- Verification: **HMAC-SHA512 for Paystack** (`PAYSTACK_WEBHOOK_SECRET`), provider-specific
  signatures for the rest (`MONNIFY_WEBHOOK_SECRET`, `MAPLERAD_WEBHOOK_SECRET`,
  `EVERSEND_WEBHOOK_SECRET`, `DOJAH_WEBHOOK_SECRET`, `YOUVERIFY_WEBHOOK_SECRET`,
  `SMILEID_*`, plus `PAYMAX_/PAYOUT_/BILLING_/BNPL_/DISBURSE_/INVEST_BROKER_WEBHOOK_SECRET`).
- Provider seams (`interfaces.go`): `PaymentProvider` (Initialize/Verify/Payout/VerifyWebhook),
  `DisbursementProvider` (banks/resolve/recipient/payout/status/parse+verify webhook),
  `CardIssuer`, `VirtualAccountProvider`, KYC provider seam.
- Money application from a webhook goes through the **ledger** (idempotent) — so a replayed
  event must be a no-op (I5/I6).

## 2. Manual test cases (run per provider/handler)

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| WH-SEC-001 | Valid signature accepted | P0 | secret configured | POST event with correct HMAC/signature | sandbox event | 200; effect applied once |
| WH-SEC-002 | Forged/invalid signature rejected | P0 | secret configured | POST event with wrong/absent signature | tampered sig | 401/400; **no** ledger effect |
| WH-SEC-003 | Tampered body, valid-looking sig | P0 | — | Alter amount after signing | body≠sig | Rejected; nothing applied |
| WH-SEC-004 | Replay same event → idempotent | P0 | event already applied | POST identical event again | same event id | No double-credit; same terminal state |
| WH-INT-001 | Payment success credits wallet | P0 | pending topup ref | POST `charge.success` | matching reference | Wallet credited exactly once via ledger; topup marked paid |
| WH-INT-002 | Payment failed does not credit | P0 | pending ref | POST `charge.failed` | — | No credit; ref marked failed |
| WH-INT-003 | Unknown reference | P1 | — | POST event with unmatched reference | random ref | 200 acknowledged, no effect (no orphan credit) |
| WH-INT-004 | Payout/transfer status webhook | P0 | pending bank transfer | POST transfer success/reversed | matching ref | Transfer state updated; reversal re-credits per I7 |
| WH-INT-005 | Card event (Maplerad) | P1 | issued card | POST authorization/settlement event | sandbox | Ledger plan applied once; balance reconciles |
| WH-INT-006 | KYC provider webhook | P1 | pending KYC | POST verification result | Dojah/SmileID sandbox | KYC state transitions per FSM (see kyc-and-tiers) |
| WH-INT-007 | Gateway vs utility routing (web) | P1 | — | POST a vote-payment event and a bill event | both | Each routed to the correct sub-handler; no cross-application |
| WH-SEC-005 | Out-of-order events | P2 | — | Deliver `success` then a late `pending` | reordered | Terminal state not regressed |

## 3. Adapter contract cases

| Case ID | Title | Priority | Notes |
|---|---|---|---|
| PROV-CON-001 | Bank list / resolve account | P1 | `DisbursementProvider.ListBanks`/`ResolveAccount` shape stable; unresolvable account → clean error |
| PROV-CON-002 | Recipient + payout lifecycle | P0 | create recipient → initiate payout → status; failure path surfaces as reversal |
| PROV-CON-003 | Provider selection/routing | P1 | disbursement `registry.go` picks provider; mock vs livewrap behave the same at the seam |
| PROV-CON-004 | Card issuer lifecycle | P1 | issue/reveal/freeze/terminate transitions valid; reveal requires authz |
| PROV-CON-005 | Virtual account provision | P1 | `ProvisionVirtualAccount`/`GetVirtualAccount` idempotent per user |

## 4. Automated specs to add

- `backend/internal/webhooks/<provider>_signature_test.go` — valid/forged/tampered/replay table
  per provider (extends existing money-invariants HMAC test). Prioritize thin adapters
  `eversend`, `mycover`, `octamile`, `cac` (gap G10).
- Web `tests/unit/webhooks/paystack-routing.spec.ts` — gateway vs utility routing + replay.
- Idempotent-application integration test: apply the same event twice against real ledger.

## 5. Coverage target & exit criteria

Exit: signature verification proven (valid accept / forged reject) on every configured provider;
replay idempotency proven on payment + payout; gateway/utility routing correct; no provider
adapter missing a signature test at go-live.
