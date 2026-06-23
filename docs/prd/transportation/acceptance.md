# Acceptance & QA

## Acceptance Criteria

**Ride-Hailing**
- Request a ride · choose instant or offer fare · driver accepts or counters · **system blocks fare below configured floor** · track driver · trip PIN required before start · share trip · trigger SOS · payment completes · driver receives earnings · receipt generated.

**Parcel Delivery**
- Create delivery · courier accepts · pickup PIN required · dropoff PIN/proof required · track parcel · **completion releases escrow/payment** · dispute can be opened.

**Bus Booking**
- Search route · select schedule · select seat · pay · QR ticket generated · operator validates boarding · view ticket.

**Driver App**
- Onboard · upload vehicle documents · admin approves · go online · accept jobs · view earnings · request payout.

**Admin**
- Configure prices · configure commissions · approve drivers · approve vehicles · monitor live trips · resolve disputes · process refunds · view reports · all actions audited.

---

## QA focus (derive tests from these)
- **Unit:** fare calc (instant/offer/counter) · fare-floor + driver-profit-floor enforcement · commission tiers · ETA/distance via maps adapter mock · trip/parcel/bus/towing/mover state transitions · escrow release conditions · ledger posting · idempotency.
- **Integration:** ride request → dispatch → assignment → PIN → completion → payment → settlement · parcel pickup/dropoff PIN → POD → escrow release · bus book → QR → boarding validation · driver onboarding → admin approval → go online · safety trigger → incident case → Safety Center.
- **Safety:** SOS routing · route-deviation detection threshold · unexpected-stop check-in escalation · offline-trip detection · driver-document-expiry blocking.
- **Security:** unauthorized admin access · role-permission bypass · idempotency replay · payment/balance tampering · manual-wallet-edit attempt (must be blocked) · negotiation below floor (must be rejected).
- **UAT:** rider books + completes a ride · sends a parcel · books a bus seat with QR · driver onboards and accepts a job · admin configures pricing/commission · admin resolves a dispute and processes a refund · finance reconciles driver settlement.

---

## KPIs (from executive dashboard)
**Volume:** total trips · active riders/drivers/couriers/buses · gross booking value · platform revenue · driver earnings · completion rate · cancellation rate · active cities · active service categories.
**Health & integrity:** safety incidents · **offline-trip attempts** · refunds · disputes.
**Operational:** completion vs cancellation · stuck trips · high-cancellation zones · provider health · settlement timeliness.
