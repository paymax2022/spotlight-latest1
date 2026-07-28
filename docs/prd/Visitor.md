# Product Requirements Document — Visitor & Estate Access Management

**Product area:** Visitor Access, Gate Control & Guard Operations
**Platform:** Mobile (Resident app, Security Guard app), with Admin web support
**Document status:** Draft v1.0
**Owner:** Product
**Last updated:** 18 June 2026

---

## 1. Document Control

| Field | Detail |
|---|---|
| Module | Visitor Estate Management (Sections E & F, with dependencies in D, I, S, W, X, Z) |
| Primary apps affected | Resident/Homeowner/Tenant app, Security Guard app |
| Secondary apps | Estate Admin app (configuration, audit), Property Manager app |
| Dependencies | Authentication, Estate/Property selection, Payments & Subscription, Notifications |
| Out of scope (this PRD) | Elections, Meetings, AI note-taking, Repairs/Maintenance, Facility booking (referenced only where they share visitor logic) |

---

## 2. Executive Summary

The Visitor Estate Management module governs how residents authorise guests, how those guests are verified at the gate, and how every entry and exit is logged for security and accountability. It is the single most frequently used feature of an estate-management product: residents touch it daily (deliveries, ride-hailing, domestic staff, guests), and guards depend on it for every gate decision.

The module must work reliably in environments with **intermittent connectivity**, support **multiple code types** for different visitor scenarios, integrate with the **payment-restriction system** (residents who owe dues lose visitor privileges), and produce a **tamper-evident audit trail** that estate administrators and security committees can rely on.

This PRD defines the resident-side access-code lifecycle, the guard-side verification workflow, the business rules connecting payments to access, notification behaviour, offline handling, data model, permissions, analytics, and a phased rollout.

---

## 3. Problem Statement & Context

Gated estates in the target market currently rely on paper visitor books, phone calls to residents, and verbal authorisation at the gate. This creates four problems:

1. **Security gaps.** Unverified entries, no reliable record of who is inside the estate, and no way to flag previously-banned individuals.
2. **Resident friction.** Residents are interrupted by gate calls for every delivery or guest; guests wait at the gate while the guard tries to reach the resident.
3. **Accountability vacuum.** When an incident occurs, there is no trustworthy log of entries, exits, vehicles, or who authorised whom.
4. **Revenue leakage / weak enforcement.** Estates struggle to enforce due payment because access is the main lever, and it is not connected to payment status.

The product solves these by replacing verbal authorisation with **pre-issued digital access codes**, giving guards a **fast scan/lookup workflow**, and connecting access privileges to a resident's **payment standing**.

---

## 4. Goals & Success Metrics

### 4.1 Product goals
- Let a resident authorise a visitor in **under 20 seconds** and share the code in one tap.
- Let a guard verify and admit a legitimate visitor in **under 15 seconds**, even offline.
- Maintain a **100% logged** record of entries and exits (no un-logged admissions in normal operation).
- Enforce payment-based access restrictions automatically and reversibly.

### 4.2 Success metrics (KPIs)

| Metric | Target | Why it matters |
|---|---|---|
| Median code-creation time | < 20s | Core resident friction |
| Median gate-verification time | < 15s | Throughput at the gate |
| % entries logged via app (vs manual) | > 90% by month 3 | Adoption & audit integrity |
| Code share completion rate | > 85% | Whether codes actually reach guests |
| Overstay alerts acted upon | > 70% | Security responsiveness |
| Offline-created logs successfully synced | > 99% | Data integrity |
| Payment-restriction recovery time (pay → access restored) | < 5 min | Fairness & support load |
| Guard app crash-free sessions | > 99.5% | Gate cannot fail |

---

## 5. Scope

### 5.1 In scope
- All resident-side access code types, creation, sharing, lifecycle, and history.
- Guard-side scan/lookup, approval, capture (photo/ID/plate), check-in/out, overstay, logs, offline mode, shift handover, panic escalation.
- Blacklist and suspicious-visitor handling.
- Payment-gating of visitor access (soft/hard restriction).
- Visitor-related notifications.
- Visitor analytics surfaced to admin.

### 5.2 Out of scope (handled by other modules but referenced)
- Subscription/dues collection mechanics (Payments module).
- Resident onboarding/approval (Auth & Estate Selection modules).
- Facility booking passes (own module; reuses QR-pass pattern).

---

## 6. Personas & Roles

| Persona | Goals | Key needs |
|---|---|---|
| **Resident (Homeowner/Tenant)** | Quickly let in guests, deliveries, staff, rides; avoid gate calls | One-tap code creation & sharing, reusable codes for staff, clear history |
| **Visitor / Guest** | Get in without friction; not have to install the app | Receive code by WhatsApp/SMS/email; show QR or read out a number |
| **Security Guard** | Verify fast, admit only legitimate visitors, log accurately | Fast scan, manual fallback, offline capability, clear approve/deny states |
| **Estate Admin** | Security oversight, rule configuration, audit | Configure code rules, view full logs, manage blacklist, see analytics |
| **Property Manager / Exco** | Oversight of their properties / committee duties | Read access to relevant logs, escalation visibility |

---

## 7. Key User Journeys

### 7.1 Resident invites a single visitor (happy path)
1. Resident opens **Visitors** tab → **Create visitor access code**.
2. Selects **Single visitor invite** → enters visitor name, phone, purpose, expected arrival.
3. Chooses validity (one-time / time-limited / date-specific).
4. System generates a **QR code + numeric code**.
5. Resident taps **Share via WhatsApp** (or SMS/email).
6. Code appears under **Active access codes**.
7. On arrival, resident receives **Visitor arrival** then **Checked-in** notifications.

### 7.2 Guard admits a visitor (happy path, online)
1. Guard opens **Scan** → scans visitor QR (or enters numeric code).
2. App shows **Visitor details confirmation**: name, host resident, unit, validity, purpose, vehicle.
3. Guard optionally captures photo / ID / plate.
4. Guard taps **Approve entry** → **Check-in success**.
5. Resident is notified; log entry is created.

### 7.3 Guard admits a visitor (offline)
1. Guard scans code; app validates against **locally cached** active codes for the estate.
2. Entry recorded locally with a **pending-sync** flag.
3. When connectivity returns, **Sync pending gate logs** pushes records; conflicts resolved server-side.

### 7.4 Walk-in / no code
1. Guard opens **Walk-in visitor request** → enters visitor details + host unit.
2. App sends **Call resident for approval** (push + in-app accept/deny).
3. Resident approves/denies; on approval, entry logged; if no response within configurable timeout, guard follows estate's fallback policy.

### 7.5 Restricted resident tries to invite a visitor
1. Resident with outstanding dues taps **Create code**.
2. System shows **Visitor access disabled due to pending payment** with outstanding balance and **Pay to restore access**.
3. After successful payment (or approved proof of payment), access is restored automatically.

---

## 8. Functional Requirements

> Requirement IDs use the prefix **VM-** (Visitor Management). Priority: **P0** = MVP/must, **P1** = important, **P2** = later.

### 8.1 Access Code Creation (Resident)

| ID | Requirement | Priority |
|---|---|---|
| VM-101 | Resident can create a visitor access code that generates both a scannable QR and a human-readable numeric code (6–8 digits). | P0 |
| VM-102 | Support **code types**: single, multiple (group under one host invite), recurring, one-time, time-limited, date-specific, multi-day. | P0 (single/one-time/time-limited), P1 (recurring/multi-day/multiple) |
| VM-103 | Support **purpose-specific codes**: delivery, ride-hailing, domestic staff, contractor, event guest, family permanent, VIP, emergency. Each carries a label visible to the guard. | P0 (delivery, guest), P1 (others) |
| VM-104 | Capture visitor details: name, phone, purpose of visit, expected arrival time/date, optional vehicle plate & description. | P0 |
| VM-105 | Validity controls: start time, end time, single-use vs multi-use, max entries, and (for recurring) day-of-week schedule. | P0 (basic), P1 (recurring schedule) |
| VM-106 | **Family member permanent access** and **domestic staff** codes can be long-lived/reusable, subject to admin-configurable maximum durations. | P1 |
| VM-107 | **Bulk guest upload** for events (CSV/contact picker), generating a guest list with one code per guest or one event code with a guest manifest. | P1 |
| VM-108 | Prevent creation when resident is under payment restriction (see §10). Show restriction screen instead. | P0 |
| VM-109 | Code creation respects admin-configured **visitor rules** (e.g., max active codes per resident, blackout hours, max validity window). | P1 |

### 8.2 Code Sharing (Resident)

| ID | Requirement | Priority |
|---|---|---|
| VM-121 | Share code via WhatsApp, SMS, and email with a pre-filled, branded message containing the numeric code, QR image/link, host name, estate name, and validity. | P0 (WhatsApp & SMS), P1 (email) |
| VM-122 | Shared message includes clear, copy-pasteable numeric code as fallback when the QR cannot be scanned. | P0 |
| VM-123 | Re-share an existing active code without regenerating it. | P1 |

### 8.3 Code Lifecycle (Resident)

| ID | Requirement | Priority |
|---|---|---|
| VM-141 | View **Active**, **Expired** code lists with status, validity, and usage count. | P0 |
| VM-142 | **Cancel/revoke** an active code; revoked codes are immediately invalid at the gate. | P0 |
| VM-143 | **Extend** a code's validity window (subject to rules) without changing the code value. | P1 |
| VM-144 | View **visitor access history** with filters (date, visitor, status, code type). | P0 |
| VM-145 | A code automatically expires at end of validity or after max entries reached. | P0 |

### 8.4 Notifications (Resident)

| ID | Requirement | Priority |
|---|---|---|
| VM-161 | **Visitor arrival** notification when a guard scans/looks up the code at the gate (before approval). | P0 |
| VM-162 | **Checked-in** notification when entry is approved. | P0 |
| VM-163 | **Checked-out** notification on exit. | P1 |
| VM-164 | **Overstayed** alert when a visitor exceeds expected/allowed duration. | P1 |
| VM-165 | **Denied access** notification with reason. | P1 |
| VM-166 | Notifications respect user notification settings and are also visible in the Notification center. | P0 |

### 8.5 Gate Verification (Guard)

| ID | Requirement | Priority |
|---|---|---|
| VM-201 | Guard logs in and selects an **assigned gate**; session is tied to gate + shift. | P0 |
| VM-202 | **Scan visitor QR** with camera; on success, show visitor details confirmation. | P0 |
| VM-203 | **Enter visitor code manually** as fallback. | P0 |
| VM-204 | **Visitor lookup** by code, phone, or name; **Resident lookup** by name/unit. | P0 |
| VM-205 | **Expected visitors list** for the gate (today's valid codes), refreshable and cached offline. | P0 |
| VM-206 | **Visitor details confirmation** shows: visitor name, host resident + unit, purpose, validity, code type, vehicle, photo (if previously captured), and any flags. | P0 |
| VM-207 | **Call resident for approval** (in-app + tel fallback) for walk-ins or ambiguous cases. | P0 |
| VM-208 | **Approve** / **Deny** entry with mandatory reason on deny. | P0 |
| VM-209 | Capture **visitor photo**, **visitor ID**, and **vehicle plate number** (manual entry; OCR optional later). | P0 (photo), P1 (ID/plate OCR) |
| VM-210 | **Vehicle entry log** ties plate to the visit record. | P1 |
| VM-211 | Purpose-specific verification flows: **delivery rider**, **ride-hailing driver**, **contractor**, **staff** verification screens with the right fields. | P1 |
| VM-212 | **Check-in success** and **Check-out** screens; check-out closes the open visit. | P0 |
| VM-213 | **Overstay monitoring** view listing visitors past expected duration. | P1 |
| VM-214 | **Gate activity log** of all entries/exits for the shift. | P0 |
| VM-215 | **Walk-in visitor request** and **Emergency entry request** flows. | P1 |
| VM-216 | **Guard shift handover** summarises open visits and pending items to the next guard. | P1 |
| VM-217 | **Guard incident report** and **Panic/security escalation** accessible from the gate dashboard. | P0 (panic), P1 (incident report) |

### 8.6 Security & Blacklist

| ID | Requirement | Priority |
|---|---|---|
| VM-241 | Admin/guard can flag a visitor (by phone/ID/plate) as **blacklisted**; scanning a blacklisted visitor raises a **Blacklisted visitor alert**. | P1 |
| VM-242 | **Suspicious visitor alert** can be raised by a guard and escalated to admin. | P1 |
| VM-243 | **Visitor denied access** is always logged with reason and actor. | P0 |
| VM-244 | Blacklist is estate-scoped and visible to all gates of the estate. | P1 |

### 8.7 Offline & Sync (Guard)

| ID | Requirement | Priority |
|---|---|---|
| VM-261 | **Offline gate mode**: guard can validate cached active codes and record entries/exits without connectivity. | P0 |
| VM-262 | Locally recorded actions are queued and **synced** when online; show pending count. | P0 |
| VM-263 | Revocations and blacklist updates propagate to gate cache on each sync; define a max staleness window (configurable, e.g., 15 min) and surface it. | P1 |
| VM-264 | Conflict resolution: server is source of truth; duplicate or already-expired admissions are flagged for admin review rather than silently dropped. | P1 |

---

## 9. Code Type Specification

| Code type | Reusable? | Typical validity | Notes |
|---|---|---|---|
| One-time | No | Until first use or expiry | Default for casual guests |
| Time-limited | Optionally | Fixed window (e.g., 2 hrs) | Auto-expires |
| Date-specific | Optionally | Specific date(s) | Event-friendly |
| Multi-day | Yes (capped) | N days | Contractors, visiting family |
| Recurring | Yes | Schedule (days/times) | Domestic staff, regular help |
| Delivery | No | Short window | Quick verify, minimal fields |
| Ride-hailing | No | Short window | Driver + plate emphasis |
| Domestic staff | Yes | Long-lived (capped) | Daily entry |
| Contractor | Yes (capped) | Project window | May require admin approval |
| Event guest (bulk) | Per guest | Event date | Guest manifest / bulk upload |
| Family permanent | Yes | Long-lived (capped) | Household-linked |
| VIP | Configurable | Configurable | Expedited handling at gate |
| Emergency | No | Immediate | Fast-track, flagged for review |

---

## 10. Payment-Gating Business Rules (Restriction Logic)

Visitor access is a privilege tied to a resident's payment standing. The Payments module owns balance state; this module **consumes** a restriction status.

| Status | Visitor-module behaviour |
|---|---|
| **In good standing** | Full access to all code types. |
| **Soft restriction** (grace period / minor overdue) | Warning banner on Visitor dashboard; access still allowed; **Pending payment alert** card shown. |
| **Hard ban** (overdue beyond threshold) | Code creation blocked → **Visitor access disabled due to pending payment**. Existing active codes may be honoured or auto-revoked per admin config. |
| **Payment made, restoration pending** | Show **Payment made, access restoration pending**; restore on confirmation. |
| **Access restored** | **Access restored confirmation**; full access resumes. |

Rules:
- **VM-301 (P0):** Restriction state is read at code-creation time and on dashboard load.
- **VM-302 (P0):** A restricted resident sees the outstanding balance and a **Pay to restore access** entry point.
- **VM-303 (P1):** Resident may **upload proof of payment**; status moves to "under review"; admin approval restores access (Payments module flow).
- **VM-304 (P1):** Resident may **appeal** a restriction or request an **exemption/waiver**; admin decision is logged.
- **VM-305 (P0):** All restriction transitions are written to a **payment ban audit trail**.
- **VM-306 (config):** Whether existing active codes survive a hard ban is **admin-configurable** per estate.

---

## 11. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | Code generation < 1s; QR scan-to-details < 2s online; gate verification operable < 15s end-to-end. |
| **Offline** | Guard app fully operable offline for verification of cached codes; resident app degrades gracefully (queue share, show cached history). |
| **Reliability** | Guard app crash-free sessions > 99.5%; no admission action lost on crash (write-ahead local log). |
| **Security** | Codes are non-guessable, time-bound, single-/limited-use; QR payloads signed/validated server-side; revocation is authoritative. |
| **Privacy** | Visitor PII (name, phone, ID, photo) minimised, access-controlled, retained per estate policy and consent; ID images encrypted at rest. |
| **Scalability** | Support estates from tens to thousands of units; gate logs partitioned per estate. |
| **Localisation** | Support local phone formats, WhatsApp-first sharing, USSD/transfer payment realities; currency localisation for balances shown. |
| **Accessibility** | Numeric-code fallback for every QR; large-tap targets on guard app for fast operation. |
| **Auditability** | Every admission, denial, revocation, and restriction change is immutable-append logged with actor, timestamp, gate, and reason. |

---

## 12. Data Model (Key Entities)

**AccessCode**
- id, estate_id, host_resident_id, property_id, code_value (numeric), qr_payload, code_type, purpose_label, status (active/expired/revoked/used), validity_start, validity_end, max_entries, entries_used, recurrence_rule, created_at, created_by

**Visitor**
- id, name, phone, vehicle_plate, vehicle_desc, id_type, id_image_ref, photo_ref, is_blacklisted, blacklist_reason

**VisitEvent**
- id, access_code_id, visitor_id, gate_id, guard_id, action (arrival/check_in/check_out/deny/walk_in/emergency), reason, timestamp, sync_status, captured_photo_ref, captured_id_ref, captured_plate

**GateSession**
- id, gate_id, guard_id, shift_start, shift_end, handover_notes

**RestrictionStatus** (consumed from Payments)
- resident_id, estate_id, state, outstanding_balance, effective_from, source

**Blacklist**
- id, estate_id, match_key (phone/id/plate), reason, created_by, created_at

---

## 13. Permissions Matrix

| Capability | Resident | Guard | Admin | Property Mgr / Exco |
|---|---|---|---|---|
| Create/revoke own codes | ✅ | — | ✅ (any, override) | — |
| View own visitor history | ✅ | — | ✅ | Scoped read |
| Scan/verify at gate | — | ✅ | — | — |
| Approve/deny entry | — | ✅ | ✅ (override) | — |
| Capture photo/ID/plate | — | ✅ | — | — |
| Manage blacklist | — | Flag only | ✅ | — |
| Configure visitor rules | — | — | ✅ | — |
| View gate logs & analytics | Own only | Own shift | ✅ (all) | Scoped |
| Apply/lift payment restriction | — | — | ✅ (via Payments) | — |

---

## 14. Analytics & Reporting (Admin)

- **Visitor analytics:** volume by day/hour, by type (delivery vs guest vs staff), by host/unit.
- **Gate activity analytics:** entries/exits per gate, peak times, average verification time.
- **Overstay & denial analytics:** denial reasons, overstay frequency.
- **Restriction impact:** number of residents with disabled visitor access, recovery times.
- **Offline integrity:** count of offline-recorded admissions and sync success rate.

---

## 15. Edge & Error States

Map to dedicated screens already in the inventory:
- **QR code expired**, **Invalid visitor code**, **Visitor code already used** → clear guard-side messaging with manual-lookup fallback.
- **Visitor denied access** → logged with reason; resident notified.
- **No internet connection** → guard app enters offline mode automatically; resident share is queued.
- **No active access codes / No visitors yet** → empty states with create CTA (resident) / lookup CTA (guard).
- **Visitor access disabled** → restriction screen with pay-to-restore.
- **Session expired / Access denied** → re-auth without losing the in-progress gate action (write-ahead log).
- **Overstayed alert** → surfaced to both resident and guard.

---

## 16. Release Plan (Phasing)

### Phase 1 — MVP (P0)
Single & one-time & time-limited codes; QR + numeric; WhatsApp/SMS share; active/expired/revoke; arrival & check-in notifications; guard scan/manual/lookup; expected visitors list; approve/deny with reason; photo capture; check-in/out; gate activity log; **offline mode + sync**; payment hard-ban blocking of code creation + restore; visitor history; panic escalation.

### Phase 2 — Core depth (P1)
Recurring/multi-day/delivery/ride-hailing/staff/contractor codes; extend code; check-out & overstay notifications; ID/plate capture & vehicle log; blacklist & suspicious alerts; walk-in & emergency entry; shift handover; proof-of-payment & appeals; soft-restriction banner; analytics dashboards.

### Phase 3 — Enhancements (P2)
Bulk event upload & guest manifests; VIP fast-track; plate OCR/ANPR; advanced staleness controls; cross-gate blacklist sync optimisation; richer reconciliation tooling.

---

## 17. Assumptions, Risks & Open Questions

**Assumptions**
- Most visitors will **not** install the app; codes must work via QR/numeric shared over WhatsApp/SMS.
- Gates experience **intermittent connectivity**; offline operation is mandatory, not optional.
- Payment standing is owned by the Payments module and exposed as a status this module reads.

**Risks**
- *Offline abuse:* a revoked code admitted during a stale offline window. Mitigation: configurable staleness limit + flagged-for-review on sync.
- *PII exposure:* visitor ID/photo data. Mitigation: encryption, retention limits, access control, consent.
- *Restriction fairness disputes:* residents blocked by payment edge cases. Mitigation: appeals/waiver flow + clear audit trail.
- *Guard adoption:* if verification is slower than a phone call, guards revert to manual. Mitigation: <15s target, large-tap UI, offline parity.

**Open questions**
1. Do existing active codes survive a hard payment ban, or auto-revoke? (Currently admin-configurable — confirm default.)
2. Maximum allowed validity for long-lived staff/family codes?
3. Is plate capture mandatory for vehicle entries in MVP or Phase 2?
4. Walk-in timeout policy when a resident does not answer — admit, hold, or deny by default?
5. Retention period for visitor photos/IDs per regulatory and estate policy?

---

## 18. Appendix — Screen Inventory Mapping

**Resident (Section E):** Visitor management dashboard; Create visitor access code; Single/Multiple/Recurring/One-time/Time-limited/Date-specific/Multi-day/Delivery/Ride-hailing/Domestic staff/Contractor/Event guest/Family permanent codes; VIP & Emergency guest access; Visitor details form (phone, vehicle, purpose, arrival); Visitor QR & numeric code; Share via WhatsApp/SMS/email; Active/Expired codes; Cancel/revoke; Extend; Arrival/Checked-in/Checked-out/Overstayed notifications; Visitor access history; Guest list & bulk upload; Visitor denied access.

**Guard (Section F):** Guard login; Guard dashboard; Assigned gate selection; Scan QR / manual code; Visitor & resident lookup; Expected visitors list; Visitor details confirmation; Call resident for approval; Approve/Deny entry; Capture photo/ID/plate; Vehicle entry log; Delivery/ride-hailing/contractor/staff verification; Walk-in & emergency entry; Blacklisted & suspicious alerts; Check-in success / Check-out; Overstay monitoring; Gate activity log; Offline gate mode; Sync pending logs; Shift handover; Incident report; Panic escalation; Gate analytics.

**Dependencies:** D (dashboard cards), I (payment restriction screens), S (revenue/ledger), W (notifications), X (visitor & gate analytics), Z (edge/error states).
