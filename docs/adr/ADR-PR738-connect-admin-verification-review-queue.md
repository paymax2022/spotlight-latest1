# ADR-PR738: Connect admin verification review queue — read-only, masked view over two vocabularies

Status: accepted

## Context
The admin console page `/admin/connect/identity` called `GET /api/connect/admin/identity`, which had never been
implemented (a 404 on staging). The data lives in `connect_verification`, whose statuses come from two
vocabularies (ADR-PR735) and which stores no handle, liveness score or masked document reference.

## Decision
- **Read-only.** Approve/reject needs its own design, an audit trail and the `connect.verification.review`
  permission; this endpoint only reads, behind `connect.verification.view`.
- **Masked by construction.** The query never selects `evidence_ref`, and `doc_hash` is used only to derive the last
  four characters of the non-reversible HMAC for a stable reference like `NIN ••••9f3a`. The response type has no field
  that could carry either value, and a live test asserts neither appears in the body.
- **A view, not a vocabulary.** Console states are derived from stored statuses: pending; approved
  (`l0_passed`, `l1_passed`, `approved`); rejected (`failed`, `rejected`); resubmit (`expired`). Unknown statuses and
  `none` (never submitted) are excluded rather than guessed at. `in_review` has no stored equivalent and is always an
  empty list.
- **Do not invent data.** `liveness_score` is null because scores are not stored; the handle falls back to
  `user <first 8 of id>` when there is no profile.
- **Registered with the admin group, not the verification service,** because the queue needs neither the pepper nor a
  provider and should work even where selfie verification is disabled.
- **Bounded:** invalid `state` is a 400 before any query; `limit` defaults to 100 and is capped at 200.

## Consequences
- `failed` (a provider check) and `rejected` (a human decision) both show as "rejected"; separating them needs a column
  the table does not have.
- Reading verification metadata is not itself audited yet; add an access-audit event when approve/reject lands.
