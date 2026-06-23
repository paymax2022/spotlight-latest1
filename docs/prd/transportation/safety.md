# Safety & Trust (first-class, cross-cutting)

> Safety is a core differentiator, not a feature bolt-on. Every safety event **creates a `SafetyIncident` case** routed to the admin Safety Center. Audio recording, women-preferred matching, and police/road-safety escalation are gated on **legal review per jurisdiction** — feature-flag them.

## Rider safety
verified-driver badge · driver photo · vehicle photo · plate number · **trip PIN** · live trip sharing · trusted contacts · **SOS button** · route-deviation alert · unexpected-stop alert · night mode · audio recording (where legal) · report unsafe driving · report harassment · anonymous phone masking · driver rating · lost-item support.

## Driver safety
verified-rider badge · rider rating · cash-rider verification · high-risk pickup alert · trip PIN · SOS · emergency support · rider-name policy · block abusive rider · fare-dispute support · destination visibility before acceptance (where allowed) · driver fatigue warning · safety training.

## Parcel safety
pickup PIN · dropoff PIN · parcel photo · declared item · prohibited-item policy · proof of delivery · insurance option · tamper dispute · courier verification.

## Bus safety
operator verification · vehicle verification · driver verification · passenger manifest · QR boarding · emergency contact · terminal verification · trip status updates · road-incident reporting.

---

## Safety lifecycle
A safety trigger (SOS, route deviation, unexpected stop, report) → creates a `SafetyIncident` (type, severity, location, description, evidence) → routes to admin **Safety Center** → escalation workflow → safety notes → optional account restriction. Dispatch console surfaces live SOS + route-deviation + stuck-trip alerts.

## Detection signals (backend)
- **Route deviation:** compare live position against expected polyline beyond a configurable threshold.
- **Unexpected stop:** stationary beyond a threshold mid-trip → check-in prompt → escalate if unanswered.
- **Driver fatigue:** scoring from continuous online/trip time.
- **High-risk pickup/dropoff:** zone-based flags.
- **Offline-trip attempt:** detect/report attempts to move the trip off-platform (ties to commission/anti-leakage).

## Admin Safety Center surfaces
SOS incidents · route deviation · driver reports · rider reports · harassment reports · accident reports · offline-trip reports · lost-item reports · escalation workflow · safety notes · account restrictions.
