# ADR-PR740: Connect admin moderation cases are a read-only projection of flagged messages and decisions

Status: accepted

## Context
The console's moderation pages expect "cases" (`GET /moderation`, `GET /moderation/:id`) with a status, AI reason codes,
severity, confidence, evidence and history. The backend has no case table for moderation: it has flagged messages
(`connect_messages.flagged` with `reason_codes`) and an append-only decision log (`connect_moderation_decisions`).

## Decision
- **A case is a flagged message.** No new table or migration. Status is derived from the *latest* decision against it:
  none or `flagged` -> open; `escalated` -> investigating; `cleared` -> dismissed; `warned`, `restricted`, `removed` ->
  actioned. The mapping lives in one SQL `CASE` used for both the filter and the returned value.
- **Never return content.** Only reason codes, the sender id and an evidence pointer (`message:<id>`); a live test seeds
  a secret body and asserts it appears nowhere. Reviewers who need the text use the existing conversation tooling.
- **Do not invent data.** `ai_confidence` is 0 and `severity` is `unrated` because neither is stored; the history comes
  from the decision log (actor = reviewer id, `model:<name>`, or `system`).
- **Bounded and safe.** `status` is validated against an allowlist (400), ids must be UUIDs (404), `limit` defaults to 100
  and is capped at 200, and the response carries `has_more`. RBAC is the existing `connect.moderation.view`.

## Review follow-ups (no blockers)
- **History for any parseable id:** the decision history is looked up with the canonical id from the case row, so an
  uppercase or braced uuid in the URL still returns its trail (it used to come back empty).
- **Deterministic ties:** the latest-decision lookup and the history order break `created_at` ties by decision id.

## Known and deferred
- **Scan cost:** the status filter is on a derived column, so each list call evaluates the decision lookup for every
  flagged message before sorting; fine at current volumes, but at ~100k flagged messages push the filter into a
  decision-first query or index `created_at WHERE flagged`. Not measured with `EXPLAIN` yet.
- **No cursor:** `has_more` says there is more but there is no offset/cursor to fetch it; narrow the status filter.
- **Case-sensitive target ids:** a decision recorded with an uppercase message id will not match the case (the join
  compares `m.id::text`); `lower()` would defeat the decisions index. Normalise at write time instead.
- Reason codes in the history are admin-entered free text; keep message text out of them.

## Consequences
- Conversation- or profile-level moderation targets do not appear as cases yet; only flagged messages do.
- A reporter is not recorded on a flagged message, so `reporter_id` is null.
- Writes (decisions, conversation state) are unchanged and remain on their existing routes.
