# Onboarding, Trust Levels & Vehicles

> **Auth is reused, not rebuilt.** Mobility onboarding assumes an already-authenticated Paymax user (see `integration.md`). Everything below *adds* verification + role data on top of the existing identity — it never implements login, session, or OTP.

## User (rider) onboarding
Reuse existing Paymax account where possible → verify phone → verify email → set up wallet → enable location → add home/work address → add emergency contact → set preferred payment → optional rider verification (ID/selfie) for high-trust badge.

### Rider trust levels
| Level | Verified | Can do |
|---|---|---|
| **Basic Rider** | Phone | Standard rides, cash (if enabled) |
| **Verified Rider** | Phone + email + ID/selfie | Verified badge, higher driver acceptance, car hire + high-value parcel jobs |
| **Business Rider** | Company profile | Multiple employees, corporate wallet, monthly reports, approval workflow |

---

## Driver onboarding
**Required:** full name · phone · email · driver photo · government ID · driver's licence · proof of address · vehicle documents · roadworthiness certificate · insurance · vehicle photos · bank account · Paymax wallet · guarantor/reference (where required) · background check · training completion · safety quiz · service-category approval.

**Driver statuses:** Draft · Submitted · UnderReview · Approved · Rejected · Suspended · ExpiredDocument · InspectionRequired · TrainingRequired · Active · Offline · OnTrip · OnDelivery · OnBreak.

**Service categories:** ride-hailing car · ride-sharing car · airport transfer · premium car · car hire/chauffeur · parcel courier · bike courier (where legal) · van delivery · bus driver · towing operator · mover-truck operator · corporate transport driver.

Every driver document carries **expiry tracking** → drives `ExpiredDocument` status + alerts.

---

## Vehicle management

**Types:** economy car · comfort car · premium car · SUV · van · mini bus · coaster bus · luxury bus · bike · dispatch bike · pickup truck · tow truck · flatbed tow truck · small/medium/large mover truck · refrigerated van · cargo van.

**Vehicle data:** plate number · make · model · year · color · category · capacity · luggage capacity · insurance · roadworthiness · inspection status · photos · owner type · fleet ID · driver assignment · service eligibility.

Admin reviews documents, insurance, roadworthiness, inspection; expiry alerts surface in the Vehicle Compliance module.
