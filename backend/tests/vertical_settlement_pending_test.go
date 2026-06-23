package tests

import "testing"

// vertical_settlement_pending_test.go holds SPEC-LEVEL, PENDING tests for the
// per-vertical settlement flows (telemedicine, estate, transport, restaurant).
// These verticals route their payouts through internal/finance/settlement, but
// each is under active development by its owning agent and the escrow→settle
// wiring is not yet stable enough to assert end-to-end here without a DB.
//
// Each test is intentionally t.Skip'd with a TODO naming the owning module and
// the invariant it must satisfy once merged. They are real, runnable scaffolds:
// remove the Skip and fill the body (against an ephemeral Postgres, using the
// settlement.Service) when the module lands.
//
// The CONSERVATION invariant they all share is already proven at the pure-math
// level in settlement_split_test.go; these add the module-specific lifecycle:
// escrow on payment, settle on service confirmation, refund on cancellation.

func TestPending_Telemedicine_AppointmentSettlement(t *testing.T) {
	t.Skip("TODO(internal/telemedicine + finance/settlement): on appointment-paid, " +
		"escrow patient payment; on consultation-completed, settle split " +
		"(doctor provider share + platform commission); on no-show/cancel, refund. " +
		"Assert: escrowed total == settled doctor + commission; refund returns full total to patient.")
}

func TestPending_Estate_RentEscrowSettlement(t *testing.T) {
	t.Skip("TODO(internal/estate + finance/settlement): on rent/booking-paid, escrow; " +
		"on move-in/handover confirmed, settle to landlord minus platform fee; " +
		"on dispute window expiry or cancellation, refund tenant. " +
		"Assert conservation and that funds cannot settle while status='disputed'.")
}

func TestPending_Transport_RideSettlement(t *testing.T) {
	t.Skip("TODO(internal/transport + finance/settlement): on ride-paid, escrow fare; " +
		"on trip-completed, settle 3-way (rider/driver share + platform commission); " +
		"on cancellation before pickup, refund. " +
		"Assert: fare == driver + platform (+ rider) to the kobo; commission tier honored " +
		"(see /admin/transport/commission/{tier} in openapi.yaml).")
}

func TestPending_Restaurant_OrderSettlement(t *testing.T) {
	t.Skip("TODO(internal/restaurant + finance/settlement): on order-paid, escrow; " +
		"on delivery-confirmed, settle (merchant share + optional rider share + commission); " +
		"on order-rejected/undelivered, refund customer. " +
		"Assert conservation and that a rejected order never settles to the merchant.")
}
