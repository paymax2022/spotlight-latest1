# OpenAPI Contracts Status

**Last Updated:** 2026-08-10  
**Decision:** 5 authoritative contracts maintained in CI; 8 legacy contracts archived

---

## Authoritative Contracts (Validated in CI)

These contracts document the active Spotlight/Paymax fintech platform APIs and are validated by Redocly in CI pipelines.

| Contract | Module(s) | Status | Redocly | Notes |
|---|---|---|---|---|
| **openapi.yaml** | Finance, Admin, Payments, Maps | 🟡 Refactoring | 🟡 41 errors | Primary fintech contract; structural YAML issues in inline descriptions (unquoted commas). Needs incremental refactoring of description strings and path params. |
| **voting.openapi.yaml** | Spotlight Contests, Open Mic | 🟢 Active | ✅ Valid | Core Spotlight feature; 12 codebase references; frontend tests validated |
| **estate.openapi.yaml** | Estate, Community | 🟢 Active | ✅ Valid | P3 vertical lane; CI-validated in visitor-election-ci |
| **restaurant.openapi.yaml** | Restaurant, Delivery, Payouts | 🟡 In-Development | ✅ Valid | Major P3 vertical; active backend implementation |
| **doctor.openapi.yaml** | Telemedicine, Health | 🟢 Active | ✅ Valid | Validated in doctor-ci; P3 roadmap |

---

## Legacy / Archived Contracts (Excluded from CI)

These contracts represent abandoned, aspirational, or superseded features. They are NOT validated by Redocly in CI to avoid noise.

| Contract | Status | Reason | Recommendation |
|---|---|---|---|
| **academy.openapi.yaml** | ❌ Obsolete | Zero codebase references; STEM/academy module not currently prioritized | Archive; revisit if academy module is prioritized |
| **connect-phase1-safety.openapi.yaml** | ❌ Superseded | Connect module routes are now inline in backend/internal/app/router.go; separate contract no longer maintained | Remove; routes documented in code |
| **fractionalre.openapi.yaml** | ❌ Abandoned | Aspirational feature; zero active implementation | Archive; may be revived later as real-estate vertical |
| **intake.openapi.yaml** | ❌ Unused | No codebase references; unclear purpose | Archive or remove entirely |
| **invest.openapi.yaml** | ⚠️ Separate System | This is the Paymax Invest crypto/trading backend, not the Spotlight fintech platform | Keep separate; do not merge with Spotlight contracts. Validated separately if needed. |
| **nutrition.openapi.yaml** | ❌ Abandoned | No active implementation; aspirational nutrition/wellness module | Archive |
| **property.openapi.yaml** | ⚠️ Incomplete | Module exists but OpenAPI contract is incomplete; not actively maintained | Archive; can fix and re-enable when property module is prioritized |
| **transfers.openapi.yaml** | ❌ Redundant | Financial transfer endpoints are already documented in openapi.yaml | Merge into openapi.yaml and remove this file |

---

## CI Configuration

### Validated Contracts
Redocly validates ONLY these 5 contracts in CI pipelines:
```yaml
- contracts/openapi.yaml
- contracts/voting.openapi.yaml
- contracts/estate.openapi.yaml
- contracts/restaurant.openapi.yaml
- contracts/doctor.openapi.yaml
```

### Legacy Contracts
All other `.openapi.yaml` files in `/contracts/` are NOT validated by Redocly and must be explicitly excluded in CI rules.

---

## Known Issues

### contracts/openapi.yaml (Primary Fintech Contract)
**Status:** Refactoring in progress  
**Errors:** 41 structural errors reported by Redocly (OpenAPI 3.0.3)

**Issues:**
1. **Unquoted descriptions with special characters** (30+ occurrences)
   - Descriptions containing commas, colons, or arrows (→) are not quoted in flow-style objects
   - Example: `{ description: Not an estate admin, or content type/size rejected }` should be `{ description: "Not an estate admin, or content type/size rejected" }`
   - These cause YAML parser to treat description fragments as separate keys

2. **Missing path parameter definition** (1 occurrence)
   - Path `/mobility/scheduled/{id}/cancel` is missing the `{id}` parameter in the operation definition

3. **Invalid operationId with URL-unsafe characters** (1 occurrence)
   - Some operationIds contain characters not allowed in URLs

**Recommended Fix Strategy:**
1. Batch-process inline descriptions to add quotes around values with special characters
2. Add missing path parameter definitions
3. Rename problematic operationIds to use only alphanumeric + underscore
4. Run `redocly lint contracts/openapi.yaml --config redocly.yaml` iteratively
5. Once fixed, merge openapi.yaml refactoring into the main fintech API contract

**Note:** The other 4 authoritative contracts (voting, estate, restaurant, doctor) already pass full Redocly validation with zero errors.

---

## Operational Guidelines

1. **Adding new features**: When adding a new vertical lane or module, create a dedicated OpenAPI contract and add it to the authoritative list above.

2. **Fixing existing contracts**: The 5 authoritative contracts should have structural errors fixed to pass Redocly strict validation.

3. **Removing obsolete contracts**: Legacy contracts can be deleted or archived with a note. Do not keep them "just in case"—if they're not validated in CI, they become a maintenance burden.

4. **Separate systems**: The Paymax Invest system (invest.openapi.yaml) should maintain its own validation pipeline separate from Spotlight fintech contracts.

---

## Architecture Context

Per `docs/architecture/audit.md`, the Spotlight/Paymax platform consists of:

**P2 Foundation (Current):**
- Platform primitives (db, redis, queues, search)
- Finance core (ledger, wallet, KYC, tiers, transfers)
- Admin (RBAC, audit)

**P3+ Vertical Lanes:**
- FX (Maplerad)
- Groups
- Events/Tickets
- Estate/Voting ✅ (has contract)
- Crowdfunding
- Restaurant/Delivery ✅ (has contract)
- Transport
- Telemedicine ✅ (has contract via doctor.openapi.yaml)
- Spotlight Integration ✅ (voting, estate)

Contracts should be created for each active lane. Legacy contracts represent lanes not yet prioritized or already completed.
