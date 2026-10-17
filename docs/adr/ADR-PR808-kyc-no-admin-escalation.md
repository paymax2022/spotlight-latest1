# ADR-PR808: Fully automated KYC — no admin escalation

## Status
Proposed

## Context
KYC verification runs through the capability gateway (Dojah, Smile ID, Youverify) with per-check routing rules and a confidence threshold. Previously, a Dojah outcome that was neither a clean PASS nor an explicit FAIL (ownership mismatch, low facial score, unclear document, AML hit, webhook REVIEW signal) was parked as `NEEDS_REVIEW` and routed to a human at `/admin/kyc` for approve/reject. Product direction is to remove the human in the loop entirely.

## Decision
Verification is fully automated. Anything that is not an unambiguous PASS is a hard FAIL. The user retries from scratch. There is no admin review surface.

Mechanically:
- `DecideTerminal` maps a provider webhook REVIEW signal to a terminal FAILED.
- `GateFacial` removes the "positive-but-low confidence → REVIEW" branch; the only outcomes are PASS or FAIL.
- `ResolveSessionStatus` treats any legacy REVIEW check row as `TIER_FAILED` so parked sessions self-heal when re-resolved.
- Admin endpoints `/review-queue`, `/cases/:id`, `/cases/:id/approve`, `/cases/:id/reject`, `/events` are removed. Routing-rule config and the per-user snapshot stay (operational, not escalation).
- A one-shot additive migration converts any existing `NEEDS_REVIEW` session to `TIER_FAILED`.
- Mobile and admin console UIs for review are deleted.

## Consequences
- A user whose documents don't fit the Dojah model may be stuck retrying — there is no manual appeal path.
- The ownership gate (PR #726) remains strict; this ADR does not weaken it, it just hardens the response from "escalate" to "fail".
- Any new policy question (an AML grey zone, a low-score bias we want to override) must now be solved in the automated gate itself; the escape hatch is gone.
