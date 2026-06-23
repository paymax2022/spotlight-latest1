# Data Model

## Entities (field lists)

**UserMobilityProfile:** id · userId · trustLevel · defaultPaymentMethod · homeAddress · workAddress · emergencyContacts · rating · completedTrips · completedDeliveries · status · createdAt · updatedAt

**Driver:** id · userId · fullName · phone · email · photoUrl · serviceCategories · verificationStatus · trainingStatus · rating · commissionTier · walletId · onlineStatus · currentLocation · status · createdAt · updatedAt

**Vehicle:** id · driverId · fleetId · plateNumber · make · model · year · color · category · capacity · documents · inspectionStatus · insuranceStatus · status · createdAt · updatedAt

**Trip:** id · riderId · driverId · vehicleId · serviceType · pickup · destination · stops · fareEstimate · finalFare · paymentMethod · status · safetyStatus · routePolyline · startedAt · completedAt · createdAt

**FareOffer:** id · tripRequestId · riderOffer · systemRecommendedFare · driverCounterOffer · acceptedFare · status · expiresAt · createdAt

**BusRoute:** id · operatorId · originTerminal · destinationTerminal · distance · estimatedDuration · status

**BusSchedule:** id · routeId · busId · departureTime · arrivalEstimate · seatMap · fare · status

**BusTicket:** id · userId · scheduleId · seatNumber · passengerDetails · qrCode · paymentStatus · boardingStatus · status

**ParcelDelivery:** id · senderId · courierId · pickup · dropoff · receiverDetails · parcelCategory · size · declaredValue · photoUrl · fare · status · proofOfDelivery · createdAt

**TowingJob:** id · userId · operatorId · vehicleType · issueType · pickupLocation · towDestination · fare · status · photos · createdAt

**MoverJob:** id · userId · providerId · pickup · dropoff · inventory · truckSize · helpersRequired · quoteAmount · escrowStatus · status · createdAt

**WalletTransaction:** id · userId · serviceType · referenceId · amount · currency · paymentMethod · status · providerReference · createdAt

**SafetyIncident:** id · userId · tripId · deliveryId · type · severity · location · description · evidence · status · assignedAdmin · createdAt

**AdminAuditLog:** id · adminId · action · entityType · entityId · oldValue · newValue · reason · ipAddress · createdAt

---

## State Machines

**Driver:** Draft · Submitted · UnderReview · Approved · Rejected · Suspended · ExpiredDocument · InspectionRequired · TrainingRequired · Active · Offline · OnTrip · OnDelivery · OnBreak

**Trip (ride):** Requested → FareNegotiating → DriverAssigned → DriverArriving → PinVerified → InProgress → Completed · (Cancelled / NoShow / SafetyHold at appropriate points)

**FareOffer:** Pending → (RiderOffered / DriverCountered) → Accepted / Rejected / Expired

**Bus ticket:** Booked → Paid → Issued (QR) → Boarding → Boarded → Completed · (Rescheduled / Cancelled / Refunded)

**Parcel:** Created → CourierAssigned → PickupPinVerified → PickedUp → InTransit → DropoffVerified(PIN/signature/photo) → Delivered · (Failed / Disputed)

**Towing:** Requested → EstimateShown → OperatorAccepted → OperatorEnRoute → PinVerified → InProgress → Completed · (Cancelled)

**Mover:** QuoteRequested → BidsReceived → BidAccepted(Escrow funded) → CrewAssigned → InProgress → CompletionConfirmed(Escrow released) · (Disputed)

---

## Lifecycle rules
- Every trip/job is traceable end-to-end (timestamps + references).
- Wallet movements are double-entry; payments use idempotency keys.
- Escrow jobs (parcel/mover/car-hire deposit/towing/business/high-value) release funds **only on proof of completion**.
- Failed/cancelled jobs release any held funds and locked supply.
- Driver documents carry expiry → trigger `ExpiredDocument` + alerts.
- Safety triggers spawn a `SafetyIncident` case.

---

## Payment & wallet (cross-cutting)
**Methods:** Paymax wallet · card · bank transfer · virtual account · cash (where enabled) · corporate wallet · group wallet · event wallet · promo balance · split payment · receiver-pays (parcels, where enabled).
**Wallet features:** trip/delivery payment · driver earnings · operator settlement · refund · promo credit · loyalty points · driver fuel wallet · driver savings wallet · business invoice payment.
