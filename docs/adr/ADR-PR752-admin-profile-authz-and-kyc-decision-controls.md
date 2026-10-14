# ADR-PR752: Scope check on user roles; reason, durable audit and separation of duties on KYC decisions

Status: accepted · Follows ADR-PR750 (admin user profile Phase 1b) and its security review.

## Context
The profile page added two read endpoints and a KYC approve/reject panel. The review found that
`GET /api/admin/users/:id/roles` skipped the object-level scope check its sibling endpoints run,
that KYC decisions left only a log line (no durable record, reason dropped, none required), and that
a reviewer holding `finance.admin.kyc` could approve their own verification and so raise their own tier.

## Decisions
1. **Roles read moves onto `AdminUsersHandler`** and reuses `canAccessUser`, instead of copying the
   check into `RBACHandler`. One implementation of "who may see which user" stays the source of truth.
   Out-of-scope is 403, matching `GET /users/:id`; making it 404 would be inconsistent with the sibling
   that already discloses existence.
2. **Decisions require a reason (1-500 chars) and are audited durably** through the shared audit sink
   (`kycverify.AdminAuditor`, satisfied by `services.AuditService`). The log line stays. The port is optional so
   tests and degraded configs still run, but production wiring always sets it.
3. **Reviewers cannot decide their own verification.** The guard sits in `Orchestrator.ResolveReview`
   (not the HTTP handler) so every caller is covered; a missing actor also fails closed. Comparison is
   case-insensitive on the id.
4. **Missing/unknown users are 404 and malformed ids 400** on the KYC snapshot, with a generic 500 otherwise.

## Consequences
- Any non-UI caller that approved without a reason now gets 400. The only in-repo callers were the existing
  KYC queue (already sends a reason) and the profile panel (updated here).
- Sole-admin deployments cannot approve their own KYC; another reviewer is needed. That is intended.
- The audit record is written after the decision is applied; a failed audit write does not undo the decision.
  `LogAction` returns no error, so a sink outage is silent. Accepted for now; revisit if the sink grows an error return.

## Not covered
Assign/remove-role scope checks (pre-existing), and the activity panel's per-user scope.
