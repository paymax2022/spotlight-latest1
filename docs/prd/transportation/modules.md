# Service Modules

> Fares run through `pricing-commission.md`; safety surfaces through `safety.md`; state machines in `data-model.md`.

## Mobility Home
Single entry point for all movement. Services: ride now · schedule ride · share ride · book bus · send parcel · hire car · tow vehicle · move house/office · business logistics · event shuttle · airport transfer.
Components: pickup location · destination search · recent destinations · saved places · active trip card · active delivery card · upcoming bus trip · promo cards · Spotlight event-transport card · safety reminder · wallet balance · quick service tiles · support shortcut.

---

## Ride-Hailing
**Categories:** economy · comfort · premium · XL/SUV · airport · female-preferred (where legally reviewed) · verified-driver · quiet · business · event.
**Flow:** pick pickup → pick destination → system shows fare range → choose instant fare or make offer → request to nearby drivers → drivers accept/counter → select driver or auto-match → driver arrives → **verify trip PIN** → trip starts → route monitored → payment → trip ends → receipt + rating.
Includes: arrival tracking, add stop, change destination, share trip, SOS, in-trip issue report, tip, lost item, cancellation + reason, fare dispute.

## Ride-Sharing / Carpool
Reduce rider cost + raise driver occupancy. Types: same-route · scheduled carpool · office commute · campus · event · church/mosque group · estate-to-office · Spotlight fan pool. Rules: users must be verified · configurable max detour · pickup/dropoff clustering · shared-fare discount · driver earns better total · riders see co-rider first name + rating · women-only pool (where legally reviewed) · **stronger safety controls than normal rides**.

## Scheduled Rides
Schedule screen → date/time → fare estimate → confirmation → upcoming rides list → detail → modify/cancel → reminder. Scheduled fare locks an estimate with adjustment rules.

## Bus Booking
**Inter-state** (e.g. Lagos↔Abuja) and **intra-state** (terminal-to-terminal, BRT-like, corporate/school/estate/event shuttles). Customer features: route + terminal search · date · seat selection · operator profiles/photos · vehicle type · departure/arrival · luggage policy · price · insurance option · manifest · **QR ticket + boarding pass** · terminal directions · reschedule · cancel/refund · trip tracking · driver/conductor details · emergency contacts. **Categories:** economy · standard · executive · luxury · sleeper · mini · coaster · student/staff/event shuttle.
**Operator portal:** route mgmt · schedule mgmt · seat inventory · pricing · manifest · driver + vehicle assignment · terminal mgmt · ticket validation · refund rules · sales report · reconciliation.

## Parcel Delivery
Same-city · intercity · scheduled · express · marketplace · SME · event/fan merch · equipment.
**Flow:** pickup → dropoff → describe parcel → size → photo → declared value → speed → price → pay (or receiver-pay where enabled) → courier accepts → **pickup PIN** → tracked → **dropoff PIN/signature/photo** → receipt.
**Sizes:** document · small · medium · large · fragile · food · electronics · fashion · event merch · business shipment · custom. Safety: prohibited-item declaration, photo proof, PINs, tracking, insurance, declared value, tamper warning, courier rating, dispute. **Intercity** adds: departure/arrival city, bus/logistics-partner selection, terminal dropoff/pickup instructions, terminal-arrival notification, receiver verification.

## Car Hire & Chauffeur
Daily/hourly hire · airport pickup · wedding/event · executive chauffeur · film production · artist movement · corporate guest · tourism · VIP. Features: car type · duration · chauffeur-or-self-drive (where legal + insured) · trip plan · multiple stops · special requests · deposit · security deposit · contract terms · driver/vehicle details · overtime billing · trip extension · receipt.

## Airport Transfer
Select airport · flight details · arrival/departure · pickup-sign details · luggage count · vehicle selection · booking review · ride tracking.

## Towing & Roadside Assistance
Services: towing van · flatbed · jumpstart · tire change · fuel delivery (where legal) · battery · accident recovery · vehicle unlock · roadside mechanic · emergency tow to workshop / user destination.
**Flow:** select service → share location → vehicle type → issue → photo → estimate → operator accepts → operator navigates → **verify operator (PIN)** → service starts → ends → pay → receipt + rating. Safety: operator + plate verification, live tracking, emergency-contact sharing, police/road-safety escalation info (where required), high-risk-location alert.

## Mover Trucks
House/office/shop/student/estate move · equipment · film/Spotlight production · event setup. Features: pickup/dropoff · property type · inventory checklist · item photos/videos · truck-size recommendation · helpers · packing · dismantling · fragile flag · insurance · elevator/stairs details · time window · quote request → **provider bids** → **escrow payment** → completion confirmation → damage dispute. Pricing factors: distance · truck size · helpers · time · stairs/elevator · fragility · packing · waiting · fuel surcharge · insurance.

## Business Logistics
SMEs · restaurants · pharmacies · shops · e-commerce · event organizers · Spotlight merch sellers · film teams · estate facility managers. Features: bulk delivery creation · CSV upload · API order creation · route batching · multiple stops · driver assignment · proof of delivery · cash-on-delivery (where enabled) · wallet settlement · business dashboard · monthly invoice · delivery analytics · failed-delivery management.

## Event Transport (Spotlight)
See `product.md` for the Spotlight tie-in. Features: event-page transport button · group ride · fan bus · venue shuttle · artist transport · crew logistics · equipment van · ticket+ride / ticket+bus bundle · venue geofencing · post-event surge control · sponsor rides · promo code. Flow: buy ticket → app suggests ride/bus/shuttle → book → link to ticket → reminder → QR/ride PIN → post-event pickup zone → rate.
