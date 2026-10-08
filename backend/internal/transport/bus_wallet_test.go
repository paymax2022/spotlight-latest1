package transport

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestBusTicketIDForKey_DeterministicAndUserScoped(t *testing.T) {
	a := busTicketIDForKey("u1", "k")
	if a != busTicketIDForKey("u1", "k") {
		t.Fatal("same user+key must give the same ticket id")
	}
	if a == busTicketIDForKey("u2", "k") || a == busTicketIDForKey("u1", "k2") {
		t.Fatal("ticket id must differ per user and per key")
	}
}

func TestClassifyBusTicketInsertErr(t *testing.T) {
	pg := func(code, constraint string) error {
		return fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: code, ConstraintName: constraint})
	}
	cases := []struct {
		name string
		err  error
		want ticketInsertErr
	}{
		{"seat (new partial index)", pg("23505", "bus_tickets_schedule_seat_active_uidx"), ticketInsertSeatTaken},
		{"seat (legacy constraint)", pg("23505", "bus_tickets_schedule_id_seat_number_key"), ticketInsertSeatTaken},
		{"idempotency key", pg("23505", "bus_tickets_idempotency_key_key"), ticketInsertDuplicate},
		{"pk", pg("23505", "bus_tickets_pkey"), ticketInsertDuplicate},
		{"other unique", pg("23505", "something_else"), ticketInsertOther},
		{"fk violation", pg("23503", "bus_tickets_schedule_id_fkey"), ticketInsertOther},
		{"check violation", pg("23514", "bus_tickets_fare_kobo_check"), ticketInsertOther},
		{"plain error", errors.New("connection reset"), ticketInsertOther},
	}
	for _, c := range cases {
		if got := classifyBusTicketInsertErr(c.err); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestBusConfigBoundsAndDefaults(t *testing.T) {
	d := DefaultBusConfig()
	if d.DeferredSettlement || d.CancelCutoffMin != 120 || d.SettleGrace != 30*time.Minute || d.MinBookingLead != 15*time.Minute {
		t.Fatalf("defaults wrong: %+v", d)
	}
	for in, want := range map[int]int{1: 60, 59: 60, 60: 60, 120: 120, 1440: 1440, 5000: 1440} {
		if got := ClampCutoffMinutes(in); got != want {
			t.Errorf("ClampCutoffMinutes(%d)=%d want %d", in, got, want)
		}
	}
	if c := NewBusConfig(true, 0, -5, 0); c.CancelCutoffMin != 120 || c.SettleGrace != 30*time.Minute || !c.DeferredSettlement {
		t.Fatalf("non-positive env must fall back to defaults: %+v", c)
	}
	if c := NewBusConfig(false, 45, 9999, 20); c.CancelCutoffMin != 1440 || c.SettleGrace != 45*time.Minute || c.MinBookingLead != 20*time.Minute {
		t.Fatalf("env overrides wrong: %+v", c)
	}
	if err := validateCancelCutoff(nil); err != nil {
		t.Fatal("nil cutoff is allowed")
	}
	for _, bad := range []int{0, 59, 1441} {
		if err := validateCancelCutoff(&bad); err == nil {
			t.Errorf("cutoff %d must be rejected", bad)
		}
	}
	ok := 60
	if err := validateCancelCutoff(&ok); err != nil {
		t.Error("60 is valid")
	}
}

func TestBusBoardingWindow(t *testing.T) {
	dep := time.Date(2030, 1, 1, 12, 0, 0, 0, time.UTC)
	open, closes := busBoardingWindow(dep, nil)
	if !open.Equal(dep.Add(-3*time.Hour)) || !closes.Equal(dep.Add(24*time.Hour+30*time.Minute)) {
		t.Fatalf("no arrival: %v %v", open, closes)
	}
	arr := dep.Add(6 * time.Hour)
	_, closes = busBoardingWindow(dep, &arr)
	if !closes.Equal(arr.Add(30 * time.Minute)) {
		t.Fatalf("with arrival: %v", closes)
	}
	bad := dep.Add(-time.Hour) // nonsense arrival before departure -> ignored
	_, closes = busBoardingWindow(dep, &bad)
	if !closes.Equal(dep.Add(24*time.Hour + 30*time.Minute)) {
		t.Fatalf("bad arrival must fall back: %v", closes)
	}
}

func sp(s string) *string { return &s }
func ip(i int) *int       { return &i }

func baseRow() *busTicketRow {
	now := time.Now()
	return &busTicketRow{
		ID: "t", Status: "issued", BoardStatus: "issued", PaymentStatus: "paid", RefundStatus: "none",
		SettleMode: "deferred", PayoutState: "held", SettlementID: sp("s"), SettlementStatus: sp("escrowed"),
		CutoffMin: ip(120), FareKobo: 500000, Departure: now.Add(48 * time.Hour),
	}
}

func TestDecideBusCancel(t *testing.T) {
	now := time.Now()
	mut := func(f func(*busTicketRow)) *busTicketRow { r := baseRow(); f(r); return r }
	cases := []struct {
		name   string
		row    *busTicketRow
		byUser bool
		want   cancelVerdict
		code   string
	}{
		{"escrowed deferred early", baseRow(), true, verdictProceed, ""},
		{"inside cutoff", mut(func(r *busTicketRow) { r.Departure = now.Add(90 * time.Minute) }), true, verdictReject, CodeCancelWindowClosed},
		{"inside cutoff but operator", mut(func(r *busTicketRow) { r.Departure = now.Add(90 * time.Minute) }), false, verdictProceed, ""},
		{"after departure", mut(func(r *busTicketRow) { r.Departure = now.Add(-time.Minute) }), true, verdictReject, CodeInvalidState},
		{"already settled", mut(func(r *busTicketRow) { r.SettlementStatus = sp("settled") }), true, verdictReject, CodeRefundRequiresSupport},
		{"no settlement", mut(func(r *busTicketRow) { r.SettlementID = nil; r.SettlementStatus = nil }), true, verdictReject, CodeRefundRequiresSupport},
		{"payout in flight", mut(func(r *busTicketRow) { r.PayoutState = "releasing" }), true, verdictReject, CodeInvalidState},
		{"boarded", mut(func(r *busTicketRow) { r.Status = "boarded"; r.BoardStatus = "boarded" }), true, verdictReject, CodeInvalidState},
		{"boarded but operator cancel", mut(func(r *busTicketRow) { r.Status = "boarded"; r.BoardStatus = "boarded" }), false, verdictProceed, ""},
		{"no show", mut(func(r *busTicketRow) { r.BoardStatus = "no_show" }), true, verdictReject, CodeInvalidState},
		{"completed", mut(func(r *busTicketRow) { r.Status = "completed" }), false, verdictReject, CodeInvalidState},
		{"cancelled+refunded", mut(func(r *busTicketRow) { r.Status = "cancelled"; r.RefundStatus = RefundRefunded }), true, verdictAlreadyOK, ""},
		{"cancelled manual", mut(func(r *busTicketRow) { r.Status = "cancelled"; r.RefundStatus = RefundManualRequired }), true, verdictAlreadyOK, ""},
		{"cancelled pending resumes", mut(func(r *busTicketRow) { r.Status = "cancelled"; r.RefundStatus = RefundPending }), true, verdictResume, ""},
		{"cancelled failed resumes", mut(func(r *busTicketRow) { r.Status = "cancelled"; r.RefundStatus = RefundFailed }), true, verdictResume, ""},
		{"legacy fake-refunded row", mut(func(r *busTicketRow) { r.Status = "cancelled"; r.PaymentStatus = "refunded" }), true, verdictReject, CodeInvalidState},
		{"settlement already refunded resumes", mut(func(r *busTicketRow) { r.SettlementStatus = sp("refunded") }), true, verdictResume, ""},
		{"disputed", mut(func(r *busTicketRow) { r.SettlementStatus = sp("disputed") }), true, verdictReject, CodeInvalidState},
		{"immediate mode escrowed (settle failed) ignores cutoff", mut(func(r *busTicketRow) {
			r.SettleMode = "immediate"
			r.CutoffMin = nil
			r.Departure = now.Add(30 * time.Minute)
		}), true, verdictProceed, ""},
	}
	for _, c := range cases {
		v, err := decideBusCancel(c.row, now, c.byUser)
		if v != c.want {
			t.Errorf("%s: verdict %v want %v (err=%v)", c.name, v, c.want, err)
		}
		if c.code != "" && (err == nil || err.Code != c.code) {
			t.Errorf("%s: code %v want %s", c.name, err, c.code)
		}
		if c.code == "" && err != nil {
			t.Errorf("%s: unexpected error %v", c.name, err)
		}
		if err != nil && err.Status != http.StatusConflict {
			t.Errorf("%s: rejections are 409, got %d", c.name, err.Status)
		}
	}
}

func TestCancelResultIsTruthful(t *testing.T) {
	r := cancelResult(RefundRefunded, 500000)
	if r.HTTPStatus() != 200 || r.RefundedKobo != 500000 || r.Message == "" {
		t.Fatalf("refunded: %+v", r)
	}
	for _, s := range []string{RefundPending, RefundFailed} {
		r := cancelResult(s, 500000)
		if r.HTTPStatus() != 202 || r.RefundedKobo != 0 {
			t.Fatalf("%s must be 202 with refunded_kobo 0: %+v", s, r)
		}
	}
	if r := cancelResult(RefundManualRequired, 500000); r.RefundedKobo != 0 || r.HTTPStatus() != 200 {
		t.Fatalf("manual: %+v", r)
	}
	if formatNaira(500000) != "₦5000.00" || formatNaira(12345) != "₦123.45" {
		t.Fatalf("formatNaira wrong: %s %s", formatNaira(500000), formatNaira(12345))
	}
}
