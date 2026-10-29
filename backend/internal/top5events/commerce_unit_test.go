package top5events

// DB-free tests for the commerce layer's pure logic: the refund split a receipt
// and its refund must foot to (EVT-160), the cutoff window, the booking status a
// buyer reads on a receipt, the moderation trail's status mapping, the
// sentinel → HTTP table the commerce endpoints answer with, and the select/scan
// pairs that drift apart silently (an order row, a receipt roll-up, the admin
// event projection, a support case).

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSplitRefund_ReaddsToAmountExactly(t *testing.T) {
	for _, tc := range []struct {
		name    string
		amount  int64
		feeBps  int
		wantRef int64
		wantFee int64
	}{
		{"no fee", 50_000, 0, 50_000, 0},
		{"one percent", 100_000, 100, 99_000, 1_000},
		{"typical five percent", 10_000_000, 500, 9_500_000, 500_000},
		{"fee truncates toward the buyer", 1_999, 500, 1_900, 99},
		{"sub-kobo fee on a one-kobo seat", 1, 500, 1, 0},
		{"full fee", 25_000, 10_000, 0, 25_000},
		{"free ticket", 0, 500, 0, 0},
	} {
		refund, fee := splitRefund(tc.amount, tc.feeBps)
		if refund != tc.wantRef || fee != tc.wantFee {
			t.Errorf("%s: splitRefund(%d, %d) = (%d, %d), want (%d, %d)",
				tc.name, tc.amount, tc.feeBps, refund, fee, tc.wantRef, tc.wantFee)
		}
		// The invariant the UAT asserts: the two halves re-add to the amount.
		if refund+fee != tc.amount {
			t.Errorf("%s: refund+fee = %d, want the collected %d", tc.name, refund+fee, tc.amount)
		}
	}
}

func TestRefundWithinWindow(t *testing.T) {
	starts := time.Date(2026, 11, 20, 18, 0, 0, 0, time.UTC)
	hour := time.Hour
	for _, tc := range []struct {
		name    string
		cutoff  int
		request time.Time
		want    bool
	}{
		{"zero cutoff means no time limit", 0, starts.Add(72 * hour), true},
		{"negative cutoff is treated as none", -1, starts.Add(72 * hour), true},
		{"well before the cutoff", 24, starts.Add(-48 * hour), true},
		{"exactly at the cutoff boundary", 24, starts.Add(-24 * hour), true},
		{"one second past the cutoff", 24, starts.Add(-24*hour + time.Second), false},
		{"after the doors opened", 24, starts.Add(time.Minute), false},
		{"tightest cutoff", 1, starts.Add(-30 * time.Minute), false},
	} {
		if got := refundWithinWindow(starts, tc.cutoff, tc.request); got != tc.want {
			t.Errorf("%s: refundWithinWindow = %t, want %t", tc.name, got, tc.want)
		}
	}
}

func TestBookingStatus(t *testing.T) {
	for _, tc := range []struct {
		name string
		set  string
		tot  int64
		ref  int64
		want string
	}{
		{"single pending seat", "PENDING", 5_000, 0, "PENDING"},
		{"fully paid booking", "PAID", 20_000, 0, "PAID"},
		{"every seat refunded", "REFUNDED", 20_000, 20_000, "REFUNDED"},
		{"expired reservation", "EXPIRED", 5_000, 0, "EXPIRED"},
		{"amounts say all refunded", "PAID,REFUNDED", 20_000, 20_000, "REFUNDED"},
		{"amounts say some refunded", "PAID,REFUNDED", 20_000, 5_000, "PARTIALLY_REFUNDED"},
		{"legacy rows carry no amounts", "PAID,REFUNDED", 20_000, 0, "MIXED"},
		{"nothing collected nothing refunded", "", 0, 0, "MIXED"},
	} {
		if got := bookingStatus(tc.set, tc.tot, tc.ref); got != tc.want {
			t.Errorf("%s: bookingStatus(%q, %d, %d) = %s, want %s", tc.name, tc.set, tc.tot, tc.ref, got, tc.want)
		}
	}
}

func TestModerationStatusFor(t *testing.T) {
	for _, tc := range []struct{ action, want string }{
		{ModerationActSubmit, ModerationPending},
		{ModerationActApprove, ModerationApproved},
		{ModerationActReject, ModerationRejected},
		{ModerationActRequestChanges, ModerationChangesRequested},
		{ModerationActReinstate, ModerationApproved},
		{ModerationActSuspend, ""}, // suspending is not a review outcome
		{ModerationActFeeSet, ""},  // platform-wide, touches no event
		{"", ""},
	} {
		if got := moderationStatusFor(tc.action); got != tc.want {
			t.Errorf("moderationStatusFor(%q) = %q, want %q", tc.action, got, tc.want)
		}
	}
}

// TestModerationLabelCoversEveryAction keeps the admin timeline from ever
// rendering a bare enum to an operator.
func TestModerationLabelCoversEveryAction(t *testing.T) {
	for _, action := range []string{
		ModerationActSubmit, ModerationActApprove, ModerationActReject, ModerationActRequestChanges,
		ModerationActSuspend, ModerationActReinstate, ModerationActFeeSet,
	} {
		if label := moderationLabel(action); label == "" || label == action {
			t.Errorf("moderationLabel(%q) = %q, want a human phrase", action, label)
		}
	}
}

func TestCommerceStatus_HTTPMapping(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{nil, http.StatusOK},
		{ErrForbidden, http.StatusForbidden},
		{ErrOrganiserRequired, http.StatusForbidden},
		{ErrKYCRequired, http.StatusForbidden},
		{ErrNotFound, http.StatusNotFound},
		{ErrValidation, http.StatusBadRequest},
		{ErrUnknownRef, http.StatusBadRequest},
		{ErrBadSupportArg, http.StatusBadRequest},
		{ErrSoldOut, http.StatusConflict},
		{ErrInviteOnly, http.StatusConflict},
		{ErrTierNotOnSale, http.StatusConflict},
		{ErrNotPurchasable, http.StatusConflict},
		{ErrPromoNotApplicable, http.StatusConflict},
		{ErrCheckinNotOpen, http.StatusConflict},
		{ErrCheckinClosed, http.StatusConflict},
		{ErrAlreadyCheckedIn, http.StatusConflict},
		{ErrNotCheckedIn, http.StatusConflict},
		{ErrNotRefundable, http.StatusConflict},
		{ErrRefundUsed, http.StatusConflict},
		{ErrRefundExists, http.StatusConflict},
		{ErrRefundDecided, http.StatusConflict},
		{ErrRefundWindow, http.StatusConflict},
		{ErrRefundAutomatic, http.StatusConflict},
		{ErrCaseTerminal, http.StatusConflict},
		{ErrNotSuspended, http.StatusConflict},
		// Wrapped sentinel: a suspended organiser IS forbidden, and the wrapper
		// must carry that through the mapping.
		{ErrOrganiserSuspended, http.StatusForbidden},
		{errors.New("postgres blew up"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		if got := commerceStatus(tc.err); got != tc.want {
			t.Errorf("commerceStatus(%v) = %d, want %d", tc.err, got, tc.want)
		}
		// Wrapping must not change the answer: the sentinels travel through %w.
		if tc.err != nil {
			wrapped := fmt.Errorf("events: context: %w", tc.err)
			if got := commerceStatus(wrapped); got != tc.want {
				t.Errorf("commerceStatus(wrapped %v) = %d, want %d", tc.err, got, tc.want)
			}
		}
	}
}

// TestOrderSelectMatchesScanDestinations is the drift guard for the order row:
// the SELECT list and the scan destinations are assembled from the same flag,
// and this pins that they still agree.
func TestOrderSelectMatchesScanDestinations(t *testing.T) {
	for _, tc := range []struct {
		name string
		svc  *Service
		want int
	}{
		{"off", &Service{}, 12},
		{"commerce", &Service{commerceReads: true}, 19},
	} {
		q := "SELECT " + tc.svc.orderSelect() + orderFrom + "WHERE o.id=$1"
		if got := selectColumnCount(q); got != tc.want {
			t.Errorf("%s: order select has %d columns, want %d:\n%s", tc.name, got, tc.want, q)
		}
		row := &countingRow{}
		if _, err := tc.svc.scanOrder(row); err != nil {
			t.Fatalf("%s: scanOrder: %v", tc.name, err)
		}
		if row.n != tc.want {
			t.Errorf("%s: scanOrder took %d destinations, want %d (the select's column count)", tc.name, row.n, tc.want)
		}
	}
}

// TestBookingReceiptMatchesScanDestinations also pins the GROUP BY text: adding a
// receipt column without grouping it is a 42803 at runtime, not a compile error.
func TestBookingReceiptMatchesScanDestinations(t *testing.T) {
	const groupBase = "GROUP BY 1, o.event_id, e.title, e.venue, e.state, e.starts_at, e.fee_bps"
	for _, tc := range []struct {
		name    string
		svc     *Service
		want    int
		groupBy string
	}{
		{"off", &Service{}, 12, groupBase},
		{"commerce", &Service{commerceReads: true}, 17, groupBase + ", e.city, e.refund_policy"},
	} {
		cols, groupBy := tc.svc.bookingReceipt()
		if got := selectColumnCount("SELECT " + cols + orderFrom + "WHERE o.buyer_id=$1"); got != tc.want {
			t.Errorf("%s: receipt has %d columns, want %d:\n%s", tc.name, got, tc.want, cols)
		}
		if groupBy != tc.groupBy {
			t.Errorf("%s: GROUP BY = %q, want %q", tc.name, groupBy, tc.groupBy)
		}
		row := &countingRow{}
		if _, err := tc.svc.scanBooking(row); err != nil {
			t.Fatalf("%s: scanBooking: %v", tc.name, err)
		}
		if row.n != tc.want {
			t.Errorf("%s: scanBooking took %d destinations, want %d", tc.name, row.n, tc.want)
		}
	}
}

func TestAdminEventSummaryMatchesScanTargets(t *testing.T) {
	for _, tc := range []struct {
		svc  *Service
		want int
	}{
		{&Service{}, 11},
		{&Service{commerceReads: true}, 16},
	} {
		q := tc.svc.adminEventSummarySQL("WHERE e.id=$1")
		if got := selectColumnCount(q); got != tc.want {
			t.Errorf("admin summary has %d columns, want %d:\n%s", got, tc.want, q)
		}
		var (
			e                   AdminEventSummary
			state, organiser    string
			startsAt, createdAt timeScan
			submittedAt         *time.Time
		)
		dests := tc.svc.adminEventTargets(&e, &state, &organiser, &startsAt, &createdAt, &submittedAt)
		if len(dests) != tc.want {
			t.Errorf("admin summary scan takes %d destinations, want %d", len(dests), tc.want)
		}
	}

	// Flag off must not read a column the migration adds.
	off := (&Service{}).adminEventSummarySQL("")
	for _, col := range commerceColNames {
		if strings.Contains(off, "e."+col) {
			t.Errorf("flag-off admin summary reads pre-migration column %q", col)
		}
	}
}

func TestSupportCaseSelectMatchesScanDestinations(t *testing.T) {
	const want = 15
	q := "SELECT " + supportSelectBase + supportFrom + "WHERE c.id=$1"
	if got := selectColumnCount(q); got != want {
		t.Errorf("support select has %d columns, want %d", got, want)
	}
	row := &countingRow{}
	if _, err := scanSupportCase(row); err != nil {
		t.Fatalf("scanSupportCase: %v", err)
	}
	if row.n != want {
		t.Errorf("scanSupportCase took %d destinations, want %d", row.n, want)
	}
}

// TestQuoteRejectsBadQuantityBeforeTheDatabase uses the package's rule that a
// Service without a pool panics on first contact: passing here proves the
// quantity guard ran first.
func TestQuoteRejectsBadQuantityBeforeTheDatabase(t *testing.T) {
	svc := &Service{}
	for _, q := range []int{0, -1, MaxTicketsPerOrder + 1, 1_000} {
		if _, err := svc.Quote(context.Background(), "buyer", "event", "tier", "", q); !errors.Is(err, ErrValidation) {
			t.Errorf("Quote(quantity=%d) err = %v, want ErrValidation", q, err)
		}
	}
}
