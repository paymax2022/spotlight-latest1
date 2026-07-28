# Insurance Module — Build & Integration Plan

Implements `docs/prd/Insurance/PRD_Paymax_Microinsurance_Integration.md` into the **existing** repo
(brownfield). Reuses platform primitives; net-new = `insurance` domain + `underwriter-gateway`.
Design system: `mobile-app/reactnative/DESIGN-Mobile.md` (already encoded in `src/constants/*` tokens).

## 1. Reuse map (verified on disk — DO NOT rebuild)
- **Gateway pattern:** `backend/internal/maps/adapter.go` — small per-capability interfaces + adapters +
  `Resolve`. The `underwriter-gateway` mirrors this exactly (one interface, MyCover/Octamile adapters,
  routing table resolves adapter by `product.provider`). New adapters live in
  `backend/internal/provider/{mycover,octamile}/` next to `paystack`, `maplerad`, `eversend`.
- **Money:** `backend/internal/finance/` — `ledger` (account types incl. `AccountCommission`,
  `AccountProviderClearing`, `AccountEscrow`, `AccountRefund`), `wallet` (`Credit`/`Debit`),
  `settlement` (`Escrow`/`Settle`/`Refund`), `kyc`, `tiers`, `va`. Premium = wallet `Debit`; claim payout =
  wallet `Credit`; auto-refund = reversing `Credit`; commission = ledger entry to `AccountCommission`
  (separate from premium pass-through `AccountProviderClearing`). Kobo only; idempotency keys mandatory.
- **AuthZ:** `middleware.RequireAuthContext` + `middleware.RequirePermission(rbac, "insurance.*")` +
  `GetAuthenticatedUser`. Object-level checks live IN `insurance` service, not the proxy.
- **Routes:** aggregator pattern like `app/referral_routes.go` (`RegisterReferral(member, admin, pool, rbac)`),
  wired in `app/finance_routes.go` under `FeatureInsuranceEnabled` (already added to config).
  Member group `finance.Group("/insurance")` → `/api/finance/insurance/*`; admin `r.Group("/api/insurance/admin")`.
  Webhooks: `r.Group("/internal/webhooks")` → `/internal/webhooks/{mycover,octamile}` (signature-verified).
- **Frontend-web proxy:** catch-all `frontend-web/app/api/v1/insurance/[...path]/route.ts` →
  `proxyToGoBackend(req, '/api/finance/insurance/<...>')`, gated by `featureFlags.insurance()` (added).
- **Mobile:** Expo Router under `app/insurance/*`; feature lib `src/features/insurance/*`; design tokens in
  `src/constants/{colors,typography,radius,spacing}`; reuse `src/components/*` (ScreenHeader, StateView,
  PrimaryButton, TextInputField, SegmentedControl) + `src/features/payments` (`usePurchasePayment` +
  `PaymentSheet`) for premium pay (wallet OR card). Register in `src/constants/modules.ts` (financial).
- **Admin:** reuse the `app/admin/connect/_ui.tsx`-style inline kit (create `app/admin/insurance/_ui.tsx`);
  new `src/services/insuranceAdminService.ts`; `AdminSidebar.tsx` "Insurance" section gated by `insurance.*`.
- **Config flags:** `FeatureInsuranceEnabled` (Go) + `featureFlags.insurance()` (web) — DONE in foundation.

## 2. Compliance invariants (NON-NEGOTIABLE, from PRD §5/§10/§11/§18)
- Paymax holds NO underwriting risk; premium is **pass-through liability**, commission is the only revenue
  (separate ledger account). Underwriter + aggregator **disclosed** on every quote/bind/certificate
  (surfaced from provider, never hard-coded).
- **Debit-then-bind saga with MANDATORY auto-reverse:** a successful premium debit must NEVER leave the user
  without cover and without a refund. `BIND_FAILED → reversing CREDIT → VOID`. 0 unresolved > 24h.
- **Idempotency everywhere:** bind/claim/payout carry idempotency keys; embedded binds idempotent on
  `source_event_id`; webhooks idempotent on `(provider, external_event_id)`.
- **NDPA consent** (versioned, logged) before any provider PII share; data minimisation per product schema.
- Normalised models only past the adapter; provider JSON never leaks. Webhook-first status + reconciliation poller backstop.

## 3. Shared DB contract (IB0 OWNS; IB1 references — additive, RLS, FKs to auth.users(id), kobo BIGINT)
Tables (per PRD §9.2), created by IB0's migration; IB1 adds claims/recon/commission/event tables referencing these:
- `insurance_products` (catalog; versioned; code, display_name, product_line, provider, provider_product_code,
  binding_mode, underwriter_display, premium_model, required_kyc_tier, required_fields_schema_ref jsonb,
  sum_insured_rules jsonb, cancellation_policy_ref, active).
- `insurance_routing` (product_line → provider) — or derive from products.provider (single source of truth).
- `insurance_policy` (id, policyholder_user_id, product_code, provider, provider_policy_ref UNIQUE(provider,ref),
  binding_mode, state enum, sum_insured, premium_amount, currency, effective_at, expires_at, source_event_id
  nullable, created_at, updated_at, version) — idx (policyholder_user_id,state),(product_code,state),(expires_at).
- `insurance_premium_transaction` (policy_id, wallet_ledger_ref, idempotency_key UNIQUE, amount, direction DEBIT,
  status, provider_remittance_ref).
- `insurance_beneficiary` (policy_id, ...).
- `insurance_premium_schedule` (recurring/one-off; bill-pay link).
- `insurance_consent` (NDPA; versioned; per data-share).
- `insurance_quote` (ephemeral; ttl; provider ref).
- IB1 adds: `insurance_claim` (policy_id, provider_claim_ref UNIQUE, state enum, loss_event_at, reported_at,
  claimed_amount, approved_amount, payout_ledger_ref nullable, idempotency_key, version),
  `insurance_claim_evidence`, `insurance_claim_payout`, `insurance_provider_event`
  (provider, event_type, external_event_id, UNIQUE(provider,external_event_id), signature_verified, payload_ref,
  processed_at), `insurance_commission_entry`, `insurance_reconciliation_record`.
- RBAC perms seeded by IB0: `insurance.catalog.view/manage`, `insurance.routing.manage`,
  `insurance.provider.manage`, `insurance.policy.view`, `insurance.claim.view/manage`,
  `insurance.reconciliation.view/resolve`, `insurance.commission.view`, `insurance.refund.manage`,
  `insurance.audit.view`.

## 4. State machines (guarded transitions + side effects + audit; PRD §10)
- Policy: QUOTED→PENDING_PAYMENT→BINDING→ACTIVE→{RENEWAL_DUE→ACTIVE|LAPSED, CANCELLED, EXPIRED};
  BINDING→BIND_FAILED→(auto-reverse premium)→VOID; PENDING_PAYMENT→PAYMENT_FAILED→VOID; QUOTED→EXPIRED(ttl).
- Claim: DRAFT→FNOL_SUBMITTED→UNDER_ASSESSMENT→{NEEDS_MORE_INFO↔, APPROVED→PAYOUT_PENDING→SETTLED, REJECTED}.
- Embedded bind: EVENT_RECEIVED→COVER_RESOLVED→PREMIUM_HELD→BINDING→ACTIVE; FAILED→release hold→UNCOVERED(notify);
  INSUFFICIENT_FUNDS→UNCOVERED(offer top-up); NO_MAPPING→no-op log. Idempotent on source_event_id.

## 5. Swarm split (disjoint files)
| Agent | Layer | Deliverable |
|---|---|---|
| **IB0** | Backend core | gateway interface + MyCover/Octamile adapters + routing; catalog; quote engine; policy lifecycle; premium-bind saga + auto-reverse; consent; audit; core migration + RBAC seed; `RegisterInsurance` + frontend-web proxy. |
| **IB1** | Backend claims/embedded | claims orchestrator + payout; embedded-binding engine (event subs); provider webhooks; reconciliation + commission ledger. New pkgs + migration + `RegisterInsuranceClaims`. |
| **IM1** | Mobile buy/policy | Protection hub, browse/detail/disclosure, schema quote form, review/terms, KYC-gap, consent, premium/pay (reuse payments), bind success/fail+auto-refund, policy wallet/detail/certificate/beneficiaries, renew/cancel/refund + feature lib + InsuranceColors + modules.ts. |
| **IM2** | Mobile claims/embedded/agent/partner | claims list/FNOL/form/evidence/status/settled; wallet+device opt-in; shared `CoverBadge` affordance; agent (~8) + partner (~6) screens. Reuse IM1 lib. |
| **IA1** | Admin console | dashboard, catalog/routing/schema editors, policy/claim search+detail, premium tx, commission ledger, reconciliation workbench, provider config/event-log/webhook-replay, consent/audit export, refund queue, renewal/lapse monitor, reporting. `_ui` + service + sidebar + `insurance.*` gates. |

Orchestrator wires: Register fns in `finance_routes.go`, frontend-web proxy, mobile `modules.ts` + entry,
admin sidebar, embedded event hooks into transport/finance emit points, `insurance-ci.yml`, trackers.

## 6. Production-grade bar (DoD)
- Full PRD screen coverage, loading/empty/error/success; underwriter disclosed on quote/bind/cert.
- Money path: kobo, idempotency, debit→bind saga with auto-reverse, commission separate account, claim payout via wallet.
- Provider-agnostic (adapters + routing config); idempotent webhooks/embedded binds; NDPA consent gating.
- Mock/live switch (mobile `EXPO_PUBLIC_INSURANCE_USE_MOCK`, admin `NEXT_PUBLIC_INSURANCE_USE_MOCK`, backend
  `FeatureInsuranceEnabled` + provider sandbox); TypeScript + gofmt clean; CI build/test + tsc + additive-migration guard.
