# Module: Fractional Real Estate (fractionalre)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_FRACTIONAL_RE_ENABLED` (default off)
**Code:** `backend/internal/fractionalre/` — `routes.go`, `handler.go`, `handler_admin.go`, `service*.go` (`_offerings`, `_subscribe`, `_secondary`, `_distributions`, `_portfolio`, `_compliance`, `_reconciliation`), `model.go`, `repository.go`, `audit.go`, `referrals.go`, `beneficiaries.go`, `autoinvest_runner.go`, `service_compliance_test.go`, `service_hardening_test.go`, `service_invariants_test.go`. Mounted at `backend/internal/app/finance_routes.go:2565-2618`.
**Slug:** `FRACTIONALRE`

## 1. Overview & scope

Fractional RE lets users subscribe to fractions of real-estate offerings (escrowed until a round closes), trade fractions on a secondary market, receive distributions, and manage portfolios/beneficiaries — with a referral surface and an append-only audit log (`fre_audit_log`). Money is integer kobo. All routes require `RequireAuthContext`; the admin surface adds fine-grained RBAC slugs (`fractionalre.compliance`, `.asset_manage`, `.title_verify`, `.finance`, `.distribution_approve`, `.audit`, `.sponsor`, `.support`). Money-critical flows enforce: Idempotency-Key + replay, `OfferingOpen` state, ticket-range, a fail-closed KYC gate (verified + tier≥1), per-offer risk-ack, a 10%-of-income compliance cap, tier wallet-debit limits, and balanced escrow via the settlement/ledger primitives. Privileged operations use **maker-checker (SoD)**: round close, distribution approve, title verify all require `maker != checker`. Applies: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `feature-flags-and-audit.md`. Referral reads proxy `finance/referrals` (`../cross-cutting/` referral behavior; no money moves inside this module).

## 2. Services / endpoints in scope

### Member — `/api/finance/fractionalre` (auth only)

| Operation | Method + path | Auth | Money-path? |
|---|---|---|---|
| Activate / me / suitability / risk-ack | `POST /activate`, `GET /me`, `POST /suitability`, `POST /risk-ack` | auth | no |
| List / get offerings | `GET /offerings`, `/offerings/:id` | auth | no |
| Watch / unwatch / watchlist | `POST/DELETE /offerings/:id/watch`, `GET /watchlist` | auth | no |
| Limit check | `POST /offerings/:id/limit-check` | auth | no |
| **Subscribe** | `POST /offerings/:id/subscribe` | auth + Idempotency-Key | **yes** |
| Portfolio / holdings / payouts / statements / documents / certificates / goals | `GET /portfolio[…]`, `GET/POST /goals` | auth + owner | no |
| Auto-invest list/create/pause | `GET/POST /auto-invest`, `POST /auto-invest/:id/pause` | auth | yes (routes to subscribe) |
| Secondary market view/orders | `GET /market`, `/market/orders` | auth | no |
| **Market list** | `POST /market/list` | auth + Idempotency-Key | **yes** |
| **Market buy** | `POST /market/listings/:id/buy` | auth + Idempotency-Key | **yes** |
| Beneficiaries list/add/delete | `GET/POST /beneficiaries`, `DELETE /beneficiaries/:id` | auth + owner | no |
| Referrals | `GET /referrals` | auth | no (proxy) |

### Admin — `/api/finance/fractionalre/admin` (auth + per-route `RequirePermission`)

| Operation | Method + path | Permission | Money-path? |
|---|---|---|---|
| Dashboard / assets read / cap-table read | `GET /dashboard`, `/assets`, `/assets/:id/cap-table` | `.support` | no |
| Create/patch asset; create round; asset transition | `POST /assets`, `PATCH /assets/:id`, `POST /assets/:id/rounds`, `/assets/:id/transition` | `.asset_manage` | no |
| **Title verify** (SoD) | `POST /assets/:id/title-verify` | `.title_verify` | no |
| Round extend | `POST /rounds/:id/extend` | `.asset_manage` | no |
| **Round close / refund / allocate** (maker-checker) | `POST /rounds/:id/close`, `/refund`, `/allocate` | `.finance` | **yes** |
| Cap-table transfer | `POST /cap-table/transfer` | `.asset_manage` | units only |
| Investor limit / override / classify | `GET /investors/:id/limit`, `POST /limit-override`, `/classify` | `.compliance` | no |
| **Schedule distribution** (maker) | `POST /distributions` | `.finance` + Idempotency-Key | no (maker) |
| **Approve distribution** (checker) | `POST /distributions/:id/approve` | `.distribution_approve` | **yes** |
| Distribution submit / list / preview | `POST /:id/submit`, `GET /distributions`, `/:id/preview` | `.finance` / `.support` | no |
| Market listings / halt / controls | `GET /market/listings`, `POST /:id/halt`, `GET/PUT /market/controls` | `.support` / `.compliance` / `.finance` | no |
| Finance escrow / reconciliation / refund / fees | `GET /finance/escrow`, `/reconciliation`, `POST /finance/refunds/:roundId`, `GET /finance/fees` | `.finance` | yes (refund) |
| Sponsors | `GET/POST /sponsors` | `.sponsor` | no |
| Audit | `GET /audit` | `.audit` | no |

> Note: `OpenRound`/`OpenOffering` handler exists but has **no mounted route** (`handler_admin.go:200-206`) — confirm how an offering reaches `open`, or flag as a gap.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| 10%-income cap arithmetic + one-kobo-over block | inv | `internal/fractionalre/service_compliance_test.go` `TestComputeRetailCapHardBlock` | AUTOMATED |
| Override raises headroom | inv | `service_compliance_test.go` `TestComputeRetailCapWithOverride` | AUTOMATED |
| Soft-warn at 80% | inv | `service_compliance_test.go` `TestComputeRetailCapSoftWarn` | AUTOMATED |
| HNI/qualified exempt | inv | `service_compliance_test.go` `TestExemptClassificationsBypassCap` | AUTOMATED |
| Threshold → allocate vs refund | inv | `service_invariants_test.go` `TestThresholdDecidesAllocateVsRefund` | AUTOMATED |
| Maker-checker SoD (close) | inv | `service_invariants_test.go` `TestMakerCheckerSoD` | AUTOMATED |
| Title-verifier SoD | inv | `service_invariants_test.go` `TestTitleVerifierSoD` | AUTOMATED |
| Asset lifecycle legal/illegal transitions | fsm | `service_invariants_test.go` `TestLifecycleTransitions` | AUTOMATED |
| Subscribe/distribution require idem key | inv | `service_invariants_test.go` `TestSubscribeRequiresIdempotencyKey`, `TestScheduleDistributionRequiresIdempotencyKey` | AUTOMATED |
| Unique-violation (23505) detection | unit | `service_invariants_test.go` `TestUniqueViolationDetection` | AUTOMATED |
| Replay gate fail-closed on lookup error | inv | `service_hardening_test.go` `TestFetchReplay` | AUTOMATED |
| Secondary list/buy require idem key | inv | `service_hardening_test.go` `TestListFractionRequiresIdempotencyKey`, `TestBuyFractionRequiresIdempotencyKey` | AUTOMATED |
| Beneficiary input + cap (≤100%, ≤10) | unit | `service_hardening_test.go` `TestValidateBeneficiaryInput`, `TestBeneficiaryCapCheck` | AUTOMATED |
| Reconciliation delta | inv | `service_hardening_test.go` `TestReconcileDelta` | AUTOMATED |
| Auto-invest: once, crash-replay same key, failed-skip, no-offering, key determinism, cadence | inv | `service_hardening_test.go` `TestAutoInvestRunner*`, `TestAutoInvestIdemKeyDeterminism`, `TestNextAutoInvestRun` | AUTOMATED |
| Limit-override reason-code vocab | unit | `service_hardening_test.go` `TestLimitOverrideReasonCodes` | AUTOMATED |
| Subscribe/buy full path through real ledger+escrow | int | — (fakes only) | TODO |
| Escrow reversal on secondary partial failure | int | — | TODO |
| Distribution approve credits pro-rata via ledger | int | — | TODO |
| Admin RBAC per slug; IDOR on holdings/beneficiaries | authz | — | TODO |
| Append-only audit (failures swallowed) | sec | — | TODO |
| Flag-off route not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `FRACTIONALRE-INT-001` | Subscribe escrows funds | P0 | KYC verified tier≥1, offering `open`, risk-ack done, within cap & wallet limit | `POST /offerings/:id/subscribe` w/ idem key | `{units, amount_kobo}` within ticket range | Subscription `escrowed`; wallet→escrow balanced; `RaisedKobo` projection recomputed; audit `offering.subscribe` |
| `FRACTIONALRE-INT-002` | Round close: threshold met → allocate | P0 | round proposer set, raised ≥ min threshold | maker `POST /rounds/:id/close {propose:true}`, then checker close | — | Offering→funded; asset→funded; subscriptions `escrowed→allocated`; units + certs issued |
| `FRACTIONALRE-INT-003` | Round close: threshold NOT met → refund | P0 | raised < min threshold | close-and-settle | — | Offering→refunding→refunded; asset→refund_close; subscriptions `escrowed→refunded`; escrow returned |
| `FRACTIONALRE-INT-004` | Secondary buy settles seller + fee | P0 | active listing, market enabled, buyer within cap | `POST /market/listings/:id/buy` w/ idem key | `{units}` | Escrow → seller credited + fee→revenue; listing decremented; units transferred; audit `secondary.buy` |
| `FRACTIONALRE-INT-005` | Distribution approve pays pro-rata | P0 | distribution `submitted`, maker set | checker `POST /distributions/:id/approve` | — | Per-line `ledger.Credit` escrow→wallet; status→paid (or partial if a line fails); audit records maker |
| `FRACTIONALRE-INT-006` | Auto-invest runs due plan once | P1 | active plan, open offering | trigger runner sweep twice | deterministic key `autoinvest:{plan}:{ts}` | Exactly one subscription; schedule advances; second sweep no re-invest |
| `FRACTIONALRE-VAL-001` | Subscribe on non-open offering | P0 | offering `draft`/`closed` | subscribe | — | `ErrOfferingNotOpen`; no escrow |
| `FRACTIONALRE-VAL-002` | Subscribe below/above ticket range | P1 | open offering | amount < TicketMin / > TicketMax | boundary | `ErrTicketRange`; nothing posted |
| `FRACTIONALRE-VAL-003` | Subscribe over 10% income cap | P0 | retail, ytd near cap | subscribe one kobo over remaining | `ytd + requested = cap + 1` | `ErrLimitExceeded`; hard block (soft-warn at 80% does not block) |
| `FRACTIONALRE-VAL-004` | Subscribe without risk-ack | P1 | verified, no per-offer risk-ack | subscribe | — | `ErrRiskAckRequired` |
| `FRACTIONALRE-VAL-005` | Float/string amount rejected | P0 | open offering | `amount_kobo:"1000"` / `1000.5` | — | 400. MONEY-INV-002 |
| `FRACTIONALRE-VAL-006` | Beneficiary share sum > 100% or > 10 rows | P2 | some beneficiaries exist | add beneficiary pushing total > 100% / 11th row | — | `ErrBeneficiaryShare` / `ErrBeneficiaryLimit` |
| `FRACTIONALRE-AUTHZ-001` | Unauthenticated rejected | P0 | no token | any member route | — | 401 |
| `FRACTIONALRE-AUTHZ-002` | Admin route needs exact slug | P0 | user with `.support` only | `POST /rounds/:id/close` (`.finance`) | — | 403; fail-closed RBAC |
| `FRACTIONALRE-AUTHZ-003` | IDOR: read another user's holding | P0 | holding owned by B | `GET /portfolio/holdings/:id` as A | B's id | Not returned; owner-scoped |
| `FRACTIONALRE-AUTHZ-004` | IDOR: delete another user's beneficiary | P0 | beneficiary owned by B | `DELETE /beneficiaries/:id` as A | B's id | 403/404; no delete |
| `FRACTIONALRE-INV-001` | Idempotent subscribe replay | P0 | — | subscribe twice, same idem key | same key | 2nd returns winner via `GetSubscriptionByKey`; escrowed once (MONEY-INV-006) |
| `FRACTIONALRE-INV-002` | Concurrent same-key subscribe → one | P0 | — | N=10 concurrent, one key | one key | Unique-violation resolves to single winner (MONEY-INV-007) |
| `FRACTIONALRE-INV-003` | Distribution pro-rata conserves | P0 | cap table with holders | schedule + approve | gross/fee/withholding | `SUM(net lines) == netPool`; integer split, remainder to last holder; no negative leg |
| `FRACTIONALRE-INV-004` | Reconciliation delta zero when consistent | P1 | round with subscriptions | `GET /finance/reconciliation` | — | `delta = raised - subscribed == 0`; nonzero flagged mismatch |
| `FRACTIONALRE-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_FRACTIONAL_RE_ENABLED=false` | call any route | — | Not mounted / 404. FLAG-SEC-001 |
| `FRACTIONALRE-SEC-002` | Maker-checker: same actor blocked | P0 | round proposed by X | X also runs close-and-settle | maker==checker | `ErrMakerChecker`; no allocation. Same for distribution approve + title verify |
| `FRACTIONALRE-SEC-003` | KYC gate fail-closed on subscribe | P0 | unverified or tier 0 | subscribe | kyc0 | `ErrKYCRequired`; no escrow. See `../cross-cutting/kyc-and-tiers.md` KYC-SEC-001 |
| `FRACTIONALRE-SEC-004` | Escrow reversal on secondary partial failure | P1 | listing that fails at DecrementListing/TransferUnits after escrow | force post-escrow failure | — | Assert escrow is reversed / buyer not charged (per inventory: current code returns raw error without reversing — flag if funds trapped) |
| `FRACTIONALRE-SEC-005` | Append-only audit | P1 | any money mutation | inspect `fre_audit_log` | — | Rows inserted, never updated/deleted; no API path mutates history. AUDIT-INT-003. Note audit writes are best-effort (`_ =`) — assert a mutation still records |

## 5. State-machine transitions

Asset lifecycle — `model.go:432-454` (`CanTransition`), role-gated `.asset_manage` (title→approved requires `TitleStatus==verified`).

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| draft | begin DD | due_diligence | — | `FRACTIONALRE-FSM-001` |
| due_diligence | title check | title_verify | — | `FRACTIONALRE-FSM-002` |
| title_verify | approve (title verified) | approved | requires `TitleStatus==verified` else rejected | `FRACTIONALRE-FSM-003` |
| approved | go live | live | offering becomes subscribable | `FRACTIONALRE-FSM-004` |
| live | fund | funded | after threshold-met close | `FRACTIONALRE-FSM-005` |
| live | refund close | refund_close | after threshold miss | `FRACTIONALRE-FSM-006` |
| under_management | exit | exit → closed | terminal | `FRACTIONALRE-FSM-007` |
| draft | → live / → approved (skip) | (rejected) | illegal skip | `FRACTIONALRE-FSM-008` |
| closed | → live | (rejected) | terminal re-entry blocked | `FRACTIONALRE-FSM-009` |

Offering/round: draft→open→closing→{funded \| refunding→refunded}→closed (subscribe only when `open`). Subscription: escrowed→allocated \| escrowed→refunded. Distribution: submitted→paid \| submitted→partial (any failed line). Secondary order: escrowed→settled. Assert illegal transitions rejected (`TestLifecycleTransitions` covers asset; add DB assertions for offering/distribution).

## 6. Security & abuse cases

- Maker-checker SoD: `FRACTIONALRE-SEC-002` (close, distribution approve, title verify). Reference `../cross-cutting/rbac-and-permissions.md`.
- KYC gate fail-closed: `FRACTIONALRE-SEC-003`; `../cross-cutting/kyc-and-tiers.md`.
- Compliance cap tampering: `FRACTIONALRE-VAL-003`; server recomputes YTD (`repository.go:499-512`) — client cannot bypass; secondary buys count toward YTD.
- Idempotency/replay/concurrency: `FRACTIONALRE-INV-001..002`; `../cross-cutting/money-invariants.md`.
- Escrow-reversal on partial failure: `FRACTIONALRE-SEC-004` — flag any trapped escrow.
- Append-only audit + best-effort writes: `FRACTIONALRE-SEC-005`; `../cross-cutting/feature-flags-and-audit.md` AUDIT-INT-003.
- Amount tampering / kobo-exact: MONEY-INV-013.

## 7. Automated specs to add

- `internal/fractionalre/subscribe_int_test.go` (live-DB) — subscribe → escrow → close (allocate + refund branches) through the real ledger/settlement; idempotent replay + concurrent same-key winner.
- `internal/fractionalre/secondary_int_test.go` — buy settles seller + fee; **escrow reversal** when DecrementListing/TransferUnits fails post-escrow.
- `internal/fractionalre/distribution_int_test.go` — approve credits pro-rata via ledger; partial state on a failed line; per-line idem key retry safe.
- `internal/fractionalre/authz_test.go` — per-slug admin RBAC; IDOR on holdings, statements, beneficiaries.
- `internal/fractionalre/audit_test.go` — append-only enforcement; mutation records an event despite best-effort writes.
- Flag-off + unmounted-`OpenRound` gap confirmation.

## 8. Coverage target & exit criteria

Tier-1 floor ≥ 80% pure-logic (compliance/FSM/hardening already strong). **Exit criteria (release-blocking):** `FRACTIONALRE-INT-001..005`, `FRACTIONALRE-INV-001..003`, `FRACTIONALRE-VAL-001/003`, `FRACTIONALRE-AUTHZ-001..004`, `FRACTIONALRE-SEC-001..003`, `FRACTIONALRE-FSM-003/008/009` green. Maker-checker enforced on all three privileged flows; KYC gate fail-closed; no trapped escrow on secondary failure; audit append-only. Resolve or risk-accept the unmounted-`OpenRound` path before go-live.
