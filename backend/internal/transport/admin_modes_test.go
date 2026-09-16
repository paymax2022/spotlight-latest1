package transport

// Pure-logic unit tests for the admin mode-list derivation helpers
// (escrow/pod status mapping). DB-free and deterministic — the SQL/join side
// of ListParcels/ListTowingJobs/ListMoverJobs/ListCarHireBookings needs a live
// Postgres (TEST_DATABASE_URL-gated) and is exercised there instead.

import "testing"

func strPtr(s string) *string { return &s }

// ─── escrowStatusFromSettlement ───────────────────────────────────────────────
// Maps the shared settlements.status enum (escrowed/releasing/settled/
// disputed/refunded) onto the modes' EscrowStatus contract (none/held/
// released/refunded) used by parcels/towing/car-hire (mover_jobs has its own
// column — see moverEscrowStatus).

func TestEscrowStatusFromSettlement(t *testing.T) {
	cases := []struct {
		name   string
		status *string
		want   string
	}{
		{"no settlement row", nil, "none"},
		{"escrowed is held", strPtr("escrowed"), "held"},
		{"releasing is still held", strPtr("releasing"), "held"},
		{"disputed funds stay held", strPtr("disputed"), "held"},
		{"settled releases to provider", strPtr("settled"), "released"},
		{"refunded goes back to payer", strPtr("refunded"), "refunded"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := escrowStatusFromSettlement(c.status); got != c.want {
				t.Errorf("escrowStatusFromSettlement(%v) = %q, want %q", c.status, got, c.want)
			}
		})
	}
}

// ─── moverEscrowStatus ─────────────────────────────────────────────────────--
// mover_jobs.escrow_status uses "funded" where every other mode says "held";
// everything else already matches the shared EscrowStatus contract verbatim.

func TestMoverEscrowStatus(t *testing.T) {
	cases := []struct{ in, want string }{
		{"none", "none"},
		{"funded", "held"},
		{"released", "released"},
		{"refunded", "refunded"},
	}
	for _, c := range cases {
		if got := moverEscrowStatus(c.in); got != c.want {
			t.Errorf("moverEscrowStatus(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ─── deriveParcelPodStatus ─────────────────────────────────────────────────--
// There is no dedicated pod_status column/workflow: VerifyParcelDropoff sets
// proof_url and advances the parcel straight from dropoff_verified to
// delivered inside the same call (parcel.go), so a persisted "submitted,
// awaiting review" state never actually occurs on the normal happy path —
// only via a re-opened/disputed parcel that already carries a proof_url.

func TestDeriveParcelPodStatus(t *testing.T) {
	cases := []struct {
		name     string
		status   string
		proofURL *string
		want     string
	}{
		{"no proof at all is pending", "created", nil, "pending"},
		{"empty-string proof is pending", "in_transit", strPtr(""), "pending"},
		{"proof + delivered is approved", "delivered", strPtr("https://r2/proof.jpg"), "approved"},
		{"proof + disputed is rejected", "disputed", strPtr("https://r2/proof.jpg"), "rejected"},
		{"proof + dropoff_verified is submitted", "dropoff_verified", strPtr("https://r2/proof.jpg"), "submitted"},
		{"proof + in_transit is submitted", "in_transit", strPtr("https://r2/proof.jpg"), "submitted"},
		{"proof + cancelled is submitted", "cancelled", strPtr("https://r2/proof.jpg"), "submitted"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := deriveParcelPodStatus(c.status, c.proofURL); got != c.want {
				t.Errorf("deriveParcelPodStatus(%q, %v) = %q, want %q", c.status, c.proofURL, got, c.want)
			}
		})
	}
}
