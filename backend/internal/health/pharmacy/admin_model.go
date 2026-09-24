package healthpharmacy

// admin_model.go — request/response types for the admin console (PHARMACY-001).
// These are additive to model.go; nothing here changes the member-facing shapes.

// AdminDashboard aggregates platform-wide KPIs for the pharmacy admin console.
// Contrast with the owner/patient views (model.go), which are scoped to one
// caller.
type AdminDashboard struct {
	TotalOrders int64 `json:"total_orders"`
	// OrdersByState is a count per OrderState value (model.go), including
	// states with zero orders — the console renders a complete state
	// breakdown, not only the states that happen to have rows today.
	OrdersByState map[string]int64 `json:"orders_by_state"`
	// PlatformRevenueKoboWeek is Spotlight's realized commission on pharmacy
	// orders completed in the trailing 7 days.
	//
	// This is a direct READ of already-recorded rows, not a recomputation:
	// Complete() (service.go) does NOT itself know the commission split — the
	// breakdown is resolved server-side by the central commission module's
	// rate card (commission.Service.RecordEarning / computeBreakdown), and
	// pharmacy deliberately never imports that package (see
	// CommissionRecorder's doc comment in service.go — the interface seam
	// exists precisely so pharmacy stays ignorant of the rate, which can be
	// changed by admins at any time via the rate-card UI). Recomputing a %
	// here would mean hardcoding a rate that can silently drift from the live
	// config — exactly the class of bug PHARMACY-002/003 and Telemedicine's
	// TELEMEDICINE-002 float bug both were. Summing
	// commission_earnings.spotlight_revenue_kobo (an append-only, integer-kobo
	// ledger of exactly what Complete() recorded) for
	// source_module='health.pharmacy' is therefore the only accurate,
	// integer-only source of this figure. If the commission feature is off
	// (FeatureCommissionEnabled=false ⇒ SetCommissionRecorder is never
	// called), no rows are ever written for this module and this is honestly
	// 0 — not fabricated, not estimated.
	PlatformRevenueKoboWeek int64 `json:"platform_revenue_kobo_week"`
	// TotalPharmacies mirrors the exact APPROVED-pharmacy predicate used by
	// DiscoverPharmacies/GetPharmacy/pharmacyOwner (service.go): domain=
	// 'PHARMACY', provider_type='pharmacy', status='APPROVED'.
	TotalPharmacies int64 `json:"total_pharmacies"`
}

// allOrderStates lists every OrderState the lifecycle (model.go header
// comment) defines, used to zero-initialize AdminDashboard.OrdersByState so
// states with no current orders still appear (as 0) rather than being absent.
var allOrderStates = []OrderState{
	StateCreated, StateRxPending, StateConfirmed, StateDispensed, StateInDelivery,
	StateReadyForPickup, StateDelivered, StateCollected, StateClosed, StateCancelled, StateRefunded,
}
