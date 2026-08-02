<!-- Keep PRs < 400 lines where possible. Conventional Commit title. -->

## What & why
<!-- One paragraph: what this changes and the motivation. Link the issue/ticket. -->

## Scope
- [ ] Feature-flagged (no flag, no merge — per CLAUDE.md)
- [ ] API change started in `contracts/openapi.yaml` (spec-first) — N/A if no API change

## Money path (delete if not touched)
- [ ] Every money mutation requires an `Idempotency-Key`
- [ ] Balanced double-entry ledger entries posted; balances are projections (no direct balance writes)
- [ ] Audit event emitted; tier-limit checks fail-closed
- [ ] Failing tests written **first**, then implemented until green (`npm run test:money`)
- [ ] `ledger-auditor` review requested

## Database (delete if no migration)
- [ ] Migration is **additive-only** (no DROP / rename / type-narrowing)
- [ ] Expand/contract respected — destructive step (if any) is a **later** release
- [ ] Tested against prod-like volume; no long locks

## Auth / PII (delete if not touched)
- [ ] Object-level authorization enforced (not just route-level)
- [ ] No secrets/PII logged; sensitive data encrypted / behind signed URLs
- [ ] `security-reviewer` review requested

## Verification
- [ ] `ci.yml` gates pass locally (regression, money, contract, tsc, lint, go build/vet)
- [ ] Tests added/updated cover the change (state machine + authz paths where relevant)
- [ ] Manually verified — describe how:

## Rollout & rollback
- [ ] Safe to roll back by redeploying the prior revision (no forward-only schema dependency)
- [ ] Observability: relevant logs/metrics/alerts considered

## Screenshots / notes
<!-- Optional. -->
