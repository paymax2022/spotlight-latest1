# Admin Management Console — KYC

Brownfield: extends the existing admin app. Role-gated (KYC Ops, Compliance, Admin), every action audited. Grouped by function.

## Operations & review

| # | Screen | Purpose |
|---|---|---|
| AK1 | Review queue | All sessions/checks in `NEEDS_REVIEW` (facial below threshold, doc flagged, AML hit). Prioritized, assignable. |
| AK2 | Verification case detail | Full session: every check, provider used, confidence, extracted fields, **selfie/document evidence** (access-logged). Actions: **Approve / Reject (reason) / Request re-submit**. |
| AK3 | User KYC profile | Tier, status, full verification history, consent records, linked checks. |
| AK4 | AML / PEP hits queue | Screening hits with match detail; disposition (clear / escalate). |
| AK5 | Fraud / duplicate-identity queue | IDs flagged as previously registered (Smile `UserIDsOfPreviousRegistrants`); investigate links. |

## Configuration

| # | Screen | Purpose |
|---|---|---|
| AK6 | Provider routing rules | Per check type: ordered primary→fallback providers; enable/disable a provider; edit `kyc_routing_rule`. No code change. |
| AK7 | Thresholds & tier policy | Facial-match threshold, which checks each CBN tier requires, EDD rules. |
| AK8 | Provider credentials/health toggle | Sandbox/live toggle, key status (from vault, never shown), per-provider enable. |
| AK9 | Consent template versions | Author/version NDPA consent copy; track acceptance. |

## Monitoring & analytics

| # | Screen | Purpose |
|---|---|---|
| AK10 | Provider health dashboard | Per provider: success rate, latency, failover events, **wallet balance**, cost/check. |
| AK11 | Webhook/event monitor | Delivery, retries, dedupe, signature failures per provider. |
| AK12 | KYC funnel analytics | Conversion + drop-off by tier and step; provider mix; review rate; time-to-verify. |
| AK13 | Audit & consent log | Immutable trail of checks, admin decisions, evidence access, consent grants. |

## Authorization

- **KYC Ops** — review queue, case decisions.
- **Compliance** — AML/fraud queues, thresholds, audit/consent logs.
- **Admin** — routing rules, provider config, templates.
- **System** — runs checks, drives state transitions, ingests webhooks.

Evidence (selfies, documents, bio-data) is object-level access-controlled; **every view is logged** and visible in AK13.
