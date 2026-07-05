# Mobile App — KYC UI/UX Screens & Workflows

Built on the existing design system. Flow is save-as-you-go; step-up only asks for what the target tier needs. Provider SDKs (Smile/Youverify) are embedded for capture; data-only checks run server-side.

## Screens

**Status & consent**
| # | Screen | Purpose |
|---|---|---|
| K1 | KYC status / tier overview | Current tier + limits; "Upgrade to unlock higher limits" CTA. |
| K2 | Tier requirements | "To reach Tier n you'll need: BVN/NIN, a selfie, an ID document." Sets expectations. |
| K3 | Consent | Explicit NDPA/CBN consent before any check; records consent version. |

**Identity**
| # | Screen | Purpose |
|---|---|---|
| K4 | ID type select | Choose BVN or NIN (and, for Tier 3, document type). |
| K5 | ID number entry | Enter BVN/NIN; inline validation; "why we need this" helper. |
| K6 | ID verifying | Progress while the data match runs; result (matched name/DOB) on success. |

**Biometrics & document**
| # | Screen | Purpose |
|---|---|---|
| K7 | Selfie/liveness capture | Embedded SmartSelfie/Liveness SDK; on-screen guidance, anti-spoof. |
| K8 | Document type + capture | Capture front/back of ID; auto-capture + quality checks. |
| K9 | Document processing | OCR + authenticity + face-match progress. |
| K10 | Address (Tier 3) | Address entry / address verification for EDD. |

**Resolution**
| # | Screen | Purpose |
|---|---|---|
| K11 | Submitted / pending review | Shown when a check goes to manual review (async). |
| K12 | Success — tier upgraded | New tier + newly unlocked limits/features. |
| K13 | Failed — retry | Plain-language reason + retry or contact support; never a dead end. |
| K14 | Resume KYC | Returns to the next incomplete step. |

**Step-up**
| # | Screen | Purpose |
|---|---|---|
| K15 | Step-up verification | Triggered before a sensitive action when the user's tier is insufficient; routes into the right sub-flow. |

## Workflow (Tier 2 example)

```
K1 → K2 → K3 (consent) → K4/K5 (BVN/NIN) → K6 (ID match: PASS)
   → K7 (liveness/facial: PASS) → K12 (tier upgraded)
        └─ any check REVIEW → K11 (pending) → push notification on outcome → K12 | K13
```

## UX rules

- Ask only for the target tier's required checks; never over-collect.
- Every capture screen states why and how; show a clear privacy/consent note.
- Offline-tolerant: drafts persist; SDK captures retry gracefully; async results delivered by push to K11→K12/K13.
- Failures are actionable (reason + retry), with a manual-review path rather than a hard stop.
