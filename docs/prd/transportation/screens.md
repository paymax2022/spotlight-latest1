# Screen Inventory

> Grouped reference across three apps. Build per release phase (`product.md`). Every screen handles standard states (loading/empty/error/restricted/no-driver-found/service-unavailable-in-city/payment-failed/offline).

## CUSTOMER APP

**General:** mobility home · service-category selection · pickup search · destination search · saved places · recent locations · map selection · confirm pickup · confirm destination · active-service dashboard · notifications · promo · wallet widget · safety center · help center.

**Ride-Hailing:** service selection · destination input · fare estimate · category selection · instant fare · offer fare · driver offers · driver counteroffer · select driver · searching · driver assigned · driver arriving · trip PIN · driver profile · vehicle detail · waiting time · trip in progress · route tracking · add stop · change destination · share trip · SOS · in-trip issue report · trip completed · payment confirmation · receipt · rate driver · tip driver · lost item · cancellation · cancellation reason · fare dispute.

**Ride-Sharing:** intro · route input · time selection · co-rider preference · match · co-rider details · shared pickup points · shared route · fare split · safety · active trip · completion.

**Scheduled Ride:** schedule · date/time · fare estimate · confirmation · upcoming rides · detail · modify · cancel · reminder.

**Bus Booking:** bus home · inter-state route search · intra-state route search · origin terminal · destination terminal · travel date · passenger count · results · filter · operator profile · operator photos · seat map · select seat · passenger details · luggage details · insurance add-on · review · payment · ticket success · QR ticket · boarding pass · terminal direction · upcoming trips · trip detail · tracking · reschedule · cancellation · refund status · rate operator.

**Parcel Delivery:** home · pickup address · dropoff address · sender details · receiver details · category · size · photo upload · declared value · prohibited-item confirmation · delivery speed · fare estimate · courier selection · review · payment · courier assigned · pickup PIN · picked up · tracking · delivery PIN · proof of delivery · delivered · rate courier · issue · damage claim · missing-parcel claim.

**Intercity Parcel:** home · departure city · arrival city · bus/logistics partner · terminal dropoff instructions · receiver pickup instructions · ticket · tracking · terminal-arrival notification · receiver verification.

**Car Hire:** home · hire type · vehicle class · date/time · duration · chauffeur option · self-drive eligibility · trip plan · special request · quote · vehicle detail · driver detail · deposit payment · confirmation · active hire · extend hire · end hire · damage report · receipt.

**Airport Transfer:** home · select airport · flight details · arrival/departure selection · pickup-sign details · luggage count · vehicle selection · booking review · ride tracking.

**Towing & Roadside:** towing home · current-location confirmation · vehicle type · issue selection · vehicle photo upload · tow destination · service estimate · select operator · request confirmation · operator arriving · tow PIN · towing in progress · completed · roadside home · jumpstart · tire change · fuel assistance · mechanic request · rate operator.

**Mover Truck:** home · move-type selection · pickup property details · dropoff property details · inventory checklist · item photo/video upload · truck-size recommendation · helpers required · packing service · fragile item · move date/time · quote request · provider bids · provider profile · booking review · escrow payment · mover assigned · move in progress · completion confirmation · damage dispute · receipt.

**Business Logistics:** home · create business delivery · bulk upload · multiple stops · route preview · delivery assignment · tracking dashboard · failed delivery · proof-of-delivery list · business invoice · report · API key request.

**Event Transport:** home · Spotlight event rides · event pickup zone · shuttle selection · fan bus booking · group ride booking · ticket+ride bundle · artist/crew logistics request · equipment van request · post-event pickup guide · receipt.

**Payment:** method selection · wallet payment · card payment · bank transfer · cash confirmation · split payment · group payment · promo code · processing · success · failed · refund status · wallet top-up.

**Safety:** center · trusted contacts · add emergency contact · share live trip · SOS confirmation · route-deviation alert · unexpected-stop check-in · report unsafe driver · report unsafe rider · report harassment · report accident · report offline-trip request · safety tips.

**Profile & Settings:** profile · rider verification · saved addresses · payment settings · notification settings · privacy · trip history · delivery history · bus ticket history · car hire history · towing history · mover history · receipts/invoices · loyalty rewards · referral · help/support · terms/policies.

---

## DRIVER / PARTNER APP

**Driver Onboarding:** welcome · select service type · personal details · phone verification · email verification · profile photo · government ID · driver licence · proof of address · bank details · setup wallet · guarantor/reference · background-check consent · training intro · safety quiz · onboarding status · rejection reason · resubmit documents.

**Vehicle Onboarding:** add vehicle · category · plate number · make/model/year · color · vehicle photos · insurance · roadworthiness · vehicle licence · inspection booking · inspection status · vehicle approved.

**Driver Home:** dashboard · go online/offline · service-category toggle · earnings summary · active request card · heatmap · bonus · commission tier · wallet balance · notifications.

**Ride Driver:** incoming request · fare offer · counteroffer · accept · navigate to pickup · arrived · verify rider PIN · start trip · navigation · add-stop alert · end trip · trip earnings · rate rider · report rider · cancel · cancellation reason.

**Parcel Courier:** incoming request · delivery details · accept · navigate to pickup · verify pickup PIN · parcel photo confirmation · start delivery · navigate to dropoff · verify delivery PIN · upload proof of delivery · delivery earnings · report issue.

**Bus Operator/Driver:** dashboard · assigned route · passenger manifest · QR ticket scanner · boarding status · start trip · trip progress · passenger issue report · end trip · trip earnings/status.

**Towing Operator:** incoming request · vehicle issue detail · accept · navigate to user · verify tow PIN · start towing · upload tow photos · complete · earnings · report issue.

**Mover Provider:** incoming quote request · inventory review · submit bid · accepted job · crew assignment · navigate to pickup · start move · upload loading proof · arrive dropoff · upload completion proof · earnings · damage report.

**Driver Wallet & Support:** earnings dashboard · daily earnings · weekly earnings · payout request · payout history · fuel wallet · savings wallet · driver support · safety center · SOS · account status · document-expiry alerts · training center · driver policies.

---

## ADMIN APP

**Auth & Dashboards:** login · 2FA · executive mobility · ride operations · logistics · bus operations · towing · movers · safety · finance dashboards.

**Users & Drivers:** user list · user detail · rider verification queue · driver list · driver detail · driver document review · driver approval queue · driver suspension queue.

**Vehicles & Fleets:** vehicle list · vehicle detail · vehicle inspection queue · fleet owner list · fleet owner detail.

**Bus:** operator list · operator detail · route management · terminal management · schedule management · seat inventory · passenger manifest.

**Logistics/Towing/Movers:** parcel delivery list/detail · courier list/detail · business logistics accounts · towing operator list/detail · mover provider list/detail.

**Dispatch:** live map · active trips · active deliveries · active bus trips · active towing jobs · active mover jobs · manual dispatch.

**Pricing & Commission:** pricing settings · fare floor settings · negotiation settings · surge settings · zone pricing · commission settings · driver subscription settings · fleet commission · bus commission · logistics commission. (See `pricing-commission.md`.)

**Promotions:** promo management · event transport management · Spotlight transport campaign · driver bonus management.

**Safety:** safety incident list · SOS incident detail · route-deviation alerts · offline-trip reports · accident reports · harassment reports · lost-item reports. (See `safety.md`.)

**Disputes & Finance:** dispute list · dispute detail · refund approval · wallet reconciliation · driver settlement · operator settlement · fleet settlement · cash reconciliation.

**Reports:** revenue · commission · trip · driver · rider · safety · logistics · bus · towing · movers.

**Support & System:** support ticket list/detail · notification composer · SMS/push/email template managers · FAQ manager · policy manager · terms manager · admin user management · role permission matrix · audit log · feature flags · system settings · provider health dashboard.
