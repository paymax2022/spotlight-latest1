package healthvet

// admin_model.go — request/response types for the admin console dashboard.
// Additive to model.go; nothing here changes the member-facing shapes.
// Mirrors healthlab's admin_model.go (Lab's a0905c1b dashboard fix) and
// healthpharmacy's admin_model.go (PHARMACY-001) exactly in shape and
// discipline.

// AdminDashboard aggregates platform-wide KPIs for the vet admin console.
// Contrast with the owner/vet-scoped views (model.go), which are scoped to
// one caller.
type AdminDashboard struct {
	TotalAppointments int64 `json:"total_appointments"`
	// AppointmentsByState is a count per ApptState value (model.go), including
	// states with zero appointments — the console renders a complete state
	// breakdown, not only the states that happen to have rows today.
	AppointmentsByState map[string]int64 `json:"appointments_by_state"`
	// PlatformRevenueKoboWeek is Spotlight's realized commission on vet
	// appointments completed in the trailing 7 days.
	//
	// This is a direct READ of already-recorded rows, not a recomputation:
	// the vet service's own completion path (recordCommissionSafe, service.go
	// line 772) does NOT itself know the commission split — the breakdown is
	// resolved server-side by the central commission module's rate card
	// (commission.Service.RecordFor / computeBreakdown), and vet deliberately
	// never imports that package (see CommissionRecorder's doc comment in
	// service.go — the interface seam exists precisely so vet stays ignorant
	// of the rate, which can be changed by admins at any time via the
	// rate-card UI). Recomputing a % here would mean hardcoding a rate that
	// can silently drift from the live config — exactly the class of bug
	// PHARMACY-002/003 and Telemedicine's TELEMEDICINE-002 float bug both
	// were. Summing commission_earnings.spotlight_revenue_kobo (an
	// append-only, integer-kobo ledger of exactly what recordCommissionSafe
	// recorded) for source_module='health.vet' (service.go's
	// recordCommissionSafe call site, line 772) is therefore the only
	// accurate, integer-only source of this figure. If the commission
	// feature is off (FeatureCommissionEnabled=false ⇒
	// SetCommissionRecorder is never called), no rows are ever written for
	// this module and this is honestly 0 — not fabricated, not estimated.
	PlatformRevenueKoboWeek int64 `json:"platform_revenue_kobo_week"`
	// TotalVets mirrors the exact APPROVED-vet predicate used by
	// vetProviderGateAdapter.IsApprovedVet (backend/internal/app/health_vet_routes.go)
	// — the only "is a real, live vet" check this module has: domain='VET',
	// provider_type='vet', status='APPROVED'.
	TotalVets int64 `json:"total_vets"`
}

// allApptStates lists every ApptState the lifecycle (model.go header
// comment) defines, used to zero-initialize AdminDashboard.AppointmentsByState
// so states with no current appointments still appear (as 0) rather than
// being absent.
var allApptStates = []ApptState{
	StateRequested, StateAccepted, StateConfirmed, StateInProgress, StateCompleted,
	StateCancelled, StateNoShow, StateRescheduled,
}
