package healthlab

// admin_model.go — request/response types for the admin console dashboard.
// These are additive to model.go; nothing here changes the member-facing
// shapes. Mirrors healthpharmacy's admin_model.go (PHARMACY-001) exactly in
// shape and discipline.

// AdminDashboard aggregates platform-wide KPIs for the lab admin console.
// Contrast with the owner/patient views (model.go), which are scoped to one
// caller.
type AdminDashboard struct {
	TotalOrders int64 `json:"total_orders"`
	// OrdersByState is a count per OrderState value (model.go), including
	// states with zero orders — the console renders a complete state
	// breakdown, not only the states that happen to have rows today.
	OrdersByState map[string]int64 `json:"orders_by_state"`
	// PlatformRevenueKoboWeek is Spotlight's realized commission on lab orders
	// released in the trailing 7 days.
	//
	// This is a direct READ of already-recorded rows, not a recomputation:
	// the lab service's own release path (recordCommissionSafe, service.go)
	// does NOT itself know the commission split — the breakdown is resolved
	// server-side by the central commission module's rate card
	// (commission.Service.RecordFor / computeBreakdown), and lab deliberately
	// never imports that package (see CommissionRecorder's doc comment in
	// service.go — the interface seam exists precisely so lab stays ignorant
	// of the rate, which can be changed by admins at any time via the
	// rate-card UI). Recomputing a % here would mean hardcoding a rate that
	// can silently drift from the live config — exactly the class of bug
	// PHARMACY-002/003 and Telemedicine's TELEMEDICINE-002 float bug both
	// were. Summing commission_earnings.spotlight_revenue_kobo (an
	// append-only, integer-kobo ledger of exactly what recordCommissionSafe
	// recorded) for source_module='health.lab' (service.go's
	// recordCommissionSafe call site) is therefore the only accurate,
	// integer-only source of this figure. If the commission feature is off
	// (FeatureCommissionEnabled=false ⇒ SetCommissionRecorder is never
	// called), no rows are ever written for this module and this is honestly
	// 0 — not fabricated, not estimated.
	PlatformRevenueKoboWeek int64 `json:"platform_revenue_kobo_week"`
	// TotalLabs mirrors the exact APPROVED-lab predicate used by
	// labProviderGateAdapter.IsApprovedLab (backend/internal/app/health_lab_routes.go)
	// — the only "is a real, live lab" check this module has (there is no
	// member-facing DiscoverLabs browse endpoint to match against, unlike
	// pharmacy's DiscoverPharmacies): domain='LAB', provider_type='lab',
	// status='APPROVED'.
	TotalLabs int64 `json:"total_labs"`
}

// allOrderStates lists every OrderState the lifecycle (model.go header
// comment) defines, used to zero-initialize AdminDashboard.OrdersByState so
// states with no current orders still appear (as 0) rather than being absent.
var allOrderStates = []OrderState{
	StateCreated, StateScheduled, StateSampleCollected, StateInTransit, StateAccessioned,
	StateProcessing, StateResultReady, StateEscalated, StateReleased, StateClosed,
	StateCancelled, StateRefunded,
}
