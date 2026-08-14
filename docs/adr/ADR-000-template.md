# ADR-PR<pr-number> — Title

<!--
FILENAME: docs/adr/ADR-PR<pr-number>-<short-slug>.md
         e.g. PR #142 -> docs/adr/ADR-PR142-fx-markup-unification.md

DO NOT PICK A NUMBER. Write `ADR-PR<pr-number>` here and in EVERY reference to
this ADR — prose, Go comments, SQL migration headers. On merge to develop,
.github/workflows/adr-assign.yml allocates the next real number, renames this
file, and rewrites all those references in one commit.

Why: the number is a shared counter. Two PRs open on the same day both read
"next = 031" from their own branch and both merged, so the repo has six
duplicate numbers and needed three renumbering PRs in a single day. PR numbers
are unique and already allocated, so placeholders can never collide; assigning
the real number at merge is the only point where the counter is serialised.

adr-guard.yml fails the PR if this file carries a hand-picked number that is
already taken, or a PR number that is not this PR's.
-->

**Date:** YYYY-MM-DD  
**Status:** Proposed | Accepted | Superseded by ADR-XXX  
**Deciders:** [names or roles]

## Context

What is the problem or situation that led to this decision? Include relevant constraints, requirements, and any prior decisions it depends on.

## Decision

What did we decide to do? Be specific — name the approach, technology, pattern, or boundary.

## Consequences

### Positive
- ...

### Negative / trade-offs
- ...

### Risks
- ...

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| ... | ... |

## Related

- `docs/prd.md` § EPIC N
- `docs/audit/08-risk-register.md` § Risk ID
- Linked ADRs: ADR-XXX
