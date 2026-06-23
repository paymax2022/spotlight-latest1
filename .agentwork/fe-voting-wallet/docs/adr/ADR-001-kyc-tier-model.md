# ADR-001 — KYC Tier Model and Document Hashing

**Date:** 2026-06-13  
**Status:** Accepted  
**Deciders:** Engineering, Product, Compliance

## Context

Spotlight's fintech roadmap (docs/prd.md § EPIC 2) requires progressive KYC tiers to gate wallet limits, virtual account provisioning, and paid-vote daily caps. Three design questions arose:

1. **Where to store KYC state** — dedicated table vs. columns on `user_profiles`
2. **How many tiers** — binary (verified/not) vs. a tier ladder
3. **Document storage** — raw PII vs. hashed references vs. external provider refs only

The existing schema has three parallel user identity tables (DG-2: `auth.users`, `user_profiles`, `platform_users`). DG-2 was resolved in favour of `auth.users(id)` as the canonical FK anchor. All new fintech tables reference `auth.users(id)`.

## Decision

### 1. KYC state as columns on `user_profiles` (not a separate table)

Adding `kyc_tier`, `kyc_status`, and related columns to `user_profiles` avoids an extra join on every tier-gate check. Because `user_profiles` is 1:1 with `auth.users`, there is no fan-out risk. The audit trail is in the separate `kyc_events` table.

### 2. Four tiers (0–3)

| Tier | Name | Daily wallet limit | Requirement |
|------|------|--------------------|-------------|
| 0 | Unverified | ₦0 (disabled) | Default |
| 1 | Basic | ₦50,000 | Phone verified + BVN name match |
| 2 | Standard | ₦200,000 | Tier 1 + NIN or Passport |
| 3 | Premium | ₦5,000,000 | Tier 2 + Address proof + manual review |

Four tiers match Central Bank of Nigeria (CBN) tiered KYC guidelines for mobile money operators. Using an integer column (`SMALLINT`) allows `WHERE kyc_tier >= 1` queries without table scans.

### 3. HMAC-SHA256 hash, never raw document numbers

Raw BVN and NIN numbers are regulated PII under NDPR and CBN guidelines. We store only `HMAC-SHA256(document_number, SPOTLIGHT_KYC_HASH_SECRET || user_id)` in `bvn_hash` / `nin_hash`. The hash is used solely for deduplication (prevent one document enrolling multiple accounts). The provider reference (`document_ref`) is stored separately for verification provider lookups.

### 4. `kyc_events` as an immutable audit table

All status transitions are recorded in `kyc_events` (service_role INSERT only; no UPDATE/DELETE policy). This satisfies NDPR audit requirements and enables investigation of disputed KYC decisions.

## Consequences

### Positive
- Single-row tier check: `SELECT kyc_tier FROM user_profiles WHERE id = $1` — no join needed
- Audit trail is complete and tamper-evident
- No raw PII in the database
- Additive migration — existing code unaffected

### Negative / trade-offs
- `user_profiles` row grows; queries that `SELECT *` pull extra columns (low impact: row is narrow)
- Hash dedup only works if `SPOTLIGHT_KYC_HASH_SECRET` is stable — key rotation requires re-hash sweep

### Risks
- If `SPOTLIGHT_KYC_HASH_SECRET` env var is missing, the service falls back to `user_id` as the HMAC key. This weakens dedup but does not break operation. Alert: add this var to `validateEnv()` before production launch.
- DG-1 (CBN licensing) is still OPEN. Tier limits may need adjustment once the regulatory path is confirmed.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Dedicated `kyc_profiles` table | Extra join on every gate check; 1:1 relationship offers no benefit over columns |
| Binary verified/not | Too coarse — CBN tiered KYC requires progressive limits |
| Store document numbers encrypted | Encryption key management overhead; hash is sufficient for dedup since we don't need to recover the number |
| External-only storage (zero PII in DB) | Provider APIs have latency and rate limits; local hash dedup is faster and offline-capable |

## Related

- `docs/prd.md` § EPIC 2
- `docs/audit/06-users-data-quality.md` — DG-2 resolution
- `docs/audit/08-risk-register.md` — DG-1 (regulatory licensing, OPEN)
- `supabase/migrations/20260613000000_kyc_fields.sql`
- `supabase/migrations/20260613010000_kyc_events.sql`
- `frontend-web/src/server/kyc/service.ts`
