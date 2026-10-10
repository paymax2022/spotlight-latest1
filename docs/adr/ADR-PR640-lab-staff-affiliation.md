# ADR-PR640: Scope lab staff authorization to per-lab affiliations

## Status
Accepted (implemented in PR #640 — number assigned on merge).

## Context
HL-2 requires that staff actions on a laboratory order — sample collection,
custody handover, accessioning, result entry, and the HL-7 sign-off that
releases the patient's escrow — be performed only by staff OF the lab that owns
the order.

The provider model (`health_providers`) is single-identity and
`UNIQUE(owner_user_id, domain, provider_type)`. A `lab_scientist` or
`phlebotomist` row records that a user holds an approved capability; it names
no employing lab. A bare capability check therefore authorized ANY approved
scientist or phlebotomist on ANY lab's orders — custody of samples, result
writes, and the escrow-releasing sign-off included.

The interim fix resolved every staff check to the lab's verified owner — the
only provider-scoped answer the schema could give. That was safe but wrong the
other way: a real lab's bench scientists and field phlebotomists could not do
their jobs at all.

## Decision
Add `lab_staff` — a per-lab grant modeled after `restaurant_staff`:

- Keyed `UNIQUE(lab_provider_id, user_id)` — one grant per person per lab; two
  live grants would make "what may this person do here" ambiguous.
- `role IN ('scientist','phlebotomist')`: scientist covers bench work and the
  HL-7 release sign-off; phlebotomist covers collection and custody.
- `status IN ('ACTIVE','SUSPENDED','REMOVED')`: only `ACTIVE` authorizes.
  Suspension/removal updates the row in place so the grant history (and its
  `granted_by` attestation) is retained rather than deleted.
- Only the **verified owner of that exact lab** may write its roster
  (`Service.UpsertStaff`, `POST /api/health/lab/staff`). The grant authorizes
  clinical work and a money-releasing sign-off, so the write gate is the same
  object-level ownership the order reads use.
- The actor gate `isLabAffiliated(actor, provider, role)` is:
  verified owner of THIS lab **OR** an `ACTIVE` `lab_staff` row for
  `(provider, actor[, role])`. Owner stays authorized independently — no
  backfill grant is needed and none was added.
- Custody-facing actions (collect, handover, breach) accept either role;
  bench/sign-off actions (accession, enter results, release, amend) require
  `scientist`. The role split is why `isLabStaff` (any role) and
  `isLabScientist` are separate gates.
- Fail closed everywhere: a missing provider, a missing row, a suspended row,
  an unwired store (`nil db`), and a lookup error all deny — and denials run
  before any state check so a foreign actor gets the uniform not-found
  sentinel, never the order's state.
- RLS: the grantee reads their own grant, the owning lab reads its roster,
  admin reads all; all writes go through `service_role` (the Go service owns
  the write path).

## Why not the alternatives
- **Reuse the capability row as the grant.** Rejected — that was the bug.
  `owner_user_id` on a `lab_scientist` row is the credential-holder, not an
  employer; the schema has no place to name the lab and adding one would
  overload a table whose UNIQUE constraint is identity-shaped.
- **A staff invitation subsystem** (invites, acceptance, expiry — like
  `stays_staff_invite`). Rejected for now: the audit finding is the missing
  affiliation, not the missing invite UX. Owner-direct grants are the smallest
  write path that fixes it; an invite flow can be layered on the same table
  later (status could gain `INVITED`) without changing the gate's read side.

## Consequences
- Affiliated staff can finally operate for their own lab; every other
  combination still denies identically.
- The authorization answer changed shape: anyone relying on "staff == owner"
  (the interim gate) sees new actors succeed — this is the point, but it
  widens the set of actors who can move custody and sign off releases, so the
  grant write path is owner-only and audited (`health.lab.staff.upsert`).
- The `ProviderGate.IsVerifiedScientist/IsVerifiedPhlebotomist` seam is kept:
  the app adapter now answers "owner OR ACTIVE affiliation" so any other
  consumer stays provider-scoped, but the service reads `lab_staff` itself so
  the gate is correct even when the adapter is unwired.
- Future work: invite/acceptance flow, `INVITED` status, per-role roster
  listing endpoint, and possibly an expiry column for locum-style grants.
