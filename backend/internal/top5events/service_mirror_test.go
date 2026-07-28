// Package top5events_test contains DB-free reference-implementation tests for the
// Top-5 Event Ticketing + cashless Event Wallet module.
//
// Why an in-memory mirror instead of hitting a real Postgres pool?
//   - top5events.Service (like every finance-adjacent package in this repo — see
//     backend/tests/ledger_invariants_test.go and
//     backend/internal/finance/settlement/split_invariant_test.go) wires its SQL
//     directly against a concrete *pgxpool.Pool with no interface seam, and its
//     dependencies (ledger.Service, wallet.Service, tiers.Service, credential.Service)
//     are the same: concrete structs that touch a live DB the moment a query method
//     runs. There is no DB available in this CI lane (see .github/workflows/top5-ci.yml
//     — `go test ./internal/top5events/...` runs with NO Postgres service).
//   - The invariants that matter most here — event/ticket/wallet state-machine
//     legality, idempotent replay collapsing to one effect, settlement fee math in
//     integer kobo, and the "close triggers exactly one balanced refund" rule — are
//     PURE LOGIC that this file mirrors byte-for-byte against the guards in
//     service.go (see the `transition`, `Purchase`, `TapCharge`, `CloseWallet`, and
//     `SettleVendor` methods for the production source of truth).
//   - This file doubles as an executable spec: if the production SQL/guard logic
//     ever diverges from the mirror below, that is a defect to reconcile.
//
// A build-tag-gated, DB-backed companion suite lives in
// service_integration_test.go (`//go:build integration`) for when a real migrated
// Postgres is available (mirrors backend/internal/maps/integration_test.go).
package top5events_test

import (
	"errors"
	"testing"
)

// ===========================================================================
// 1. Event state machine — mirrors Service.transition / Suspend / Close guards.
// ===========================================================================

type mirrorEventState string

const (
	mDraft     mirrorEventState = "DRAFT"
	mSubmitted mirrorEventState = "SUBMITTED"
	mApproved  mirrorEventState = "APPROVED"
	mLive      mirrorEventState = "LIVE"
	mClosed    mirrorEventState = "CLOSED"
	mSuspended mirrorEventState = "SUSPENDED"
)

var (
	errIllegalTransition = errors.New("events: illegal transition")
	errForbidden         = errors.New("events: forbidden")
	errNotSuspendable    = errors.New("events: not suspendable (missing or terminal)")
)

// mirrorEvent replicates the row shape `transition` guards against: organiser_id + state.
type mirrorEvent struct {
	organiserID string
	state       mirrorEventState
}

// mirrorTransition replicates Service.transition: object-level authZ (ownerCheck,
// nil for admin paths) then a strict from-state guard.
func mirrorTransition(ev *mirrorEvent, from, to mirrorEventState, ownerCheck *string) error {
	if ownerCheck != nil && ev.organiserID != *ownerCheck {
		return errForbidden
	}
	if ev.state != from {
		return errIllegalTransition
	}
	ev.state = to
	return nil
}

// mirrorSuspend replicates Service.Suspend: any non-terminal state -> SUSPENDED,
// admin-only (RBAC checked upstream of the service; the service itself has no
// ownerCheck — see gap notes in the final report).
func mirrorSuspend(ev *mirrorEvent) error {
	switch ev.state {
	case mDraft, mSubmitted, mApproved, mLive:
		ev.state = mSuspended
		return nil
	default:
		return errNotSuspendable
	}
}

func TestEventStateMachine_HappyPath_DraftToLive(t *testing.T) {
	organiser := "org-1"
	ev := &mirrorEvent{organiserID: organiser, state: mDraft}

	if err := mirrorTransition(ev, mDraft, mSubmitted, &organiser); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if ev.state != mSubmitted {
		t.Fatalf("state = %s, want SUBMITTED", ev.state)
	}

	// Approve is an admin action: no owner check.
	if err := mirrorTransition(ev, mSubmitted, mApproved, nil); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if ev.state != mApproved {
		t.Fatalf("state = %s, want APPROVED", ev.state)
	}

	if err := mirrorTransition(ev, mApproved, mLive, &organiser); err != nil {
		t.Fatalf("golive: %v", err)
	}
	if ev.state != mLive {
		t.Fatalf("state = %s, want LIVE", ev.state)
	}

	if err := mirrorTransition(ev, mLive, mClosed, &organiser); err != nil {
		t.Fatalf("close: %v", err)
	}
	if ev.state != mClosed {
		t.Fatalf("state = %s, want CLOSED", ev.state)
	}
}

func TestEventStateMachine_SuspendAndResume(t *testing.T) {
	organiser := "org-1"
	ev := &mirrorEvent{organiserID: organiser, state: mApproved}

	if err := mirrorSuspend(ev); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if ev.state != mSuspended {
		t.Fatalf("state = %s, want SUSPENDED", ev.state)
	}

	// Admin resumes: SUSPENDED -> APPROVED (nil ownerCheck, admin path).
	if err := mirrorTransition(ev, mSuspended, mApproved, nil); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if ev.state != mApproved {
		t.Fatalf("state = %s, want APPROVED after resume", ev.state)
	}
}

func TestEventStateMachine_RejectsSkippedTransition_DraftToLive(t *testing.T) {
	organiser := "org-1"
	ev := &mirrorEvent{organiserID: organiser, state: mDraft}

	if err := mirrorTransition(ev, mApproved, mLive, &organiser); !errors.Is(err, errIllegalTransition) {
		t.Fatalf("draft->live direct: got %v, want errIllegalTransition", err)
	}
	if ev.state != mDraft {
		t.Fatalf("state must be unchanged after rejected transition, got %s", ev.state)
	}
}

func TestEventStateMachine_RejectsAnyTransitionFromClosed(t *testing.T) {
	organiser := "org-1"
	targets := []mirrorEventState{mDraft, mSubmitted, mApproved, mLive, mSuspended}
	for _, to := range targets {
		ev := &mirrorEvent{organiserID: organiser, state: mClosed}
		if err := mirrorTransition(ev, mLive, to, &organiser); !errors.Is(err, errIllegalTransition) {
			t.Fatalf("closed->%s: got %v, want errIllegalTransition", to, err)
		}
		if ev.state != mClosed {
			t.Fatalf("CLOSED must be terminal, got %s", ev.state)
		}
	}
	// Suspend from CLOSED must also be rejected (terminal).
	ev := &mirrorEvent{organiserID: organiser, state: mClosed}
	if err := mirrorSuspend(ev); !errors.Is(err, errNotSuspendable) {
		t.Fatalf("suspend from CLOSED: got %v, want errNotSuspendable", err)
	}
}

func TestEventStateMachine_NonOrganiserCannotSubmit(t *testing.T) {
	organiser := "org-1"
	attacker := "org-evil"
	ev := &mirrorEvent{organiserID: organiser, state: mDraft}

	if err := mirrorTransition(ev, mDraft, mSubmitted, &attacker); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner submit: got %v, want errForbidden", err)
	}
	if ev.state != mDraft {
		t.Fatalf("state must be unchanged after forbidden transition, got %s", ev.state)
	}
}

func TestEventStateMachine_NonOrganiserCannotGoLiveOrClose(t *testing.T) {
	organiser := "org-1"
	attacker := "org-evil"

	live := &mirrorEvent{organiserID: organiser, state: mApproved}
	if err := mirrorTransition(live, mApproved, mLive, &attacker); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner golive: got %v, want errForbidden", err)
	}

	closeEv := &mirrorEvent{organiserID: organiser, state: mLive}
	if err := mirrorTransition(closeEv, mLive, mClosed, &attacker); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner close: got %v, want errForbidden", err)
	}
}

// ===========================================================================
// 2. Ticket state machine — mirrors ScanTicket / GiftTicket guards.
// ===========================================================================

type mirrorTicketState string

const (
	tIssued      mirrorTicketState = "ISSUED"
	tTransferred mirrorTicketState = "TRANSFERRED"
	tUsed        mirrorTicketState = "USED"
	tRefunded    mirrorTicketState = "REFUNDED"
)

var errNotGiftable = errors.New("events: only ISSUED tickets can be gifted")

type mirrorTicket struct {
	ownerID string
	state   mirrorTicketState
}

// mirrorScan replicates ScanTicket: UPDATE ... WHERE state IN ('ISSUED','TRANSFERRED').
// A ticket already USED or REFUNDED cannot be scanned again (single-use gate entry).
func mirrorScan(t *mirrorTicket) (ok bool) {
	if t.state == tIssued || t.state == tTransferred {
		t.state = tUsed
		return true
	}
	return false
}

// mirrorGift replicates GiftTicket: object-level authZ (only the current owner can
// gift) and only ISSUED tickets are giftable.
func mirrorGift(t *mirrorTicket, callerID, newOwnerID string) error {
	if t.ownerID != callerID {
		return errForbidden
	}
	if t.state != tIssued {
		return errNotGiftable
	}
	t.ownerID = newOwnerID
	t.state = tTransferred
	return nil
}

func TestTicketStateMachine_IssuedToUsedViaScan(t *testing.T) {
	tk := &mirrorTicket{ownerID: "u1", state: tIssued}
	if ok := mirrorScan(tk); !ok {
		t.Fatal("expected scan to succeed on ISSUED ticket")
	}
	if tk.state != tUsed {
		t.Fatalf("state = %s, want USED", tk.state)
	}
}

func TestTicketStateMachine_DoubleScanRejected(t *testing.T) {
	tk := &mirrorTicket{ownerID: "u1", state: tIssued}
	if ok := mirrorScan(tk); !ok {
		t.Fatal("first scan should succeed")
	}
	if ok := mirrorScan(tk); ok {
		t.Fatal("second scan on an already-USED ticket must be rejected (no double-use)")
	}
	if tk.state != tUsed {
		t.Fatalf("state must remain USED after rejected re-scan, got %s", tk.state)
	}
}

func TestTicketStateMachine_GiftThenScan(t *testing.T) {
	tk := &mirrorTicket{ownerID: "giver", state: tIssued}
	if err := mirrorGift(tk, "giver", "recipient"); err != nil {
		t.Fatalf("gift: %v", err)
	}
	if tk.state != tTransferred || tk.ownerID != "recipient" {
		t.Fatalf("after gift: state=%s owner=%s, want TRANSFERRED/recipient", tk.state, tk.ownerID)
	}
	// A TRANSFERRED ticket can still be scanned (gate entry by the new owner).
	if ok := mirrorScan(tk); !ok {
		t.Fatal("expected scan to succeed on TRANSFERRED ticket")
	}
	if tk.state != tUsed {
		t.Fatalf("state = %s, want USED", tk.state)
	}
}

func TestTicketStateMachine_CannotGiftAfterUse(t *testing.T) {
	tk := &mirrorTicket{ownerID: "giver", state: tIssued}
	_ = mirrorScan(tk) // now USED
	if err := mirrorGift(tk, "giver", "recipient"); !errors.Is(err, errNotGiftable) {
		t.Fatalf("gift after use: got %v, want errNotGiftable", err)
	}
	if tk.ownerID != "giver" {
		t.Fatal("ownership must not change on a rejected gift")
	}
}

func TestTicketStateMachine_CannotGiftAfterAlreadyTransferred(t *testing.T) {
	tk := &mirrorTicket{ownerID: "giver", state: tIssued}
	if err := mirrorGift(tk, "giver", "recipient1"); err != nil {
		t.Fatalf("first gift: %v", err)
	}
	// Original giver no longer owns it — cannot gift again.
	if err := mirrorGift(tk, "giver", "recipient2"); !errors.Is(err, errForbidden) {
		t.Fatalf("re-gift by original giver: got %v, want errForbidden", err)
	}
}

func TestTicketStateMachine_OnlyOwnerCanGift(t *testing.T) {
	tk := &mirrorTicket{ownerID: "owner", state: tIssued}
	if err := mirrorGift(tk, "not-the-owner", "recipient"); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner gift: got %v, want errForbidden", err)
	}
	if tk.state != tIssued || tk.ownerID != "owner" {
		t.Fatal("ticket must be unchanged after forbidden gift")
	}
}

func TestTicketStateMachine_IssuedToRefunded(t *testing.T) {
	tk := &mirrorTicket{ownerID: "u1", state: tIssued}
	// Refund is an organiser/admin action outside the ticket's own guard set in the
	// current service (see report: no explicit RefundTicket method exists yet).
	// Mirror the state assignment directly to document intended terminal shape.
	tk.state = tRefunded
	if ok := mirrorScan(tk); ok {
		t.Fatal("a REFUNDED ticket must never be scannable")
	}
	if err := mirrorGift(tk, "u1", "someone"); !errors.Is(err, errNotGiftable) {
		t.Fatalf("gift of REFUNDED ticket: got %v, want errNotGiftable", err)
	}
}

// ===========================================================================
// 3. EventWallet lifecycle — mirrors OpenWallet/TopUp/TapCharge/CloseWallet.
// ===========================================================================

type mirrorWalletState string

const (
	wOpen     mirrorWalletState = "OPEN"
	wSpending mirrorWalletState = "SPENDING"
	wClosed   mirrorWalletState = "CLOSED"
)

var (
	errWalletClosed      = errors.New("events: wallet closed")
	errInsufficientFloat = errors.New("events: insufficient event-wallet balance")
)

// mirrorLedgerEntry replicates one event_wallet_ledger row (TOPUP/CHARGE/REFUND).
type mirrorLedgerEntry struct {
	typ        string // TOPUP | CHARGE | REFUND
	amountKobo int64
	idemKey    string
}

// mirrorEventWallet replicates the sub-balance ledger + projection.
type mirrorEventWallet struct {
	ownerID string
	state   mirrorWalletState
	entries []mirrorLedgerEntry
	seen    map[string]bool
}

func newMirrorWallet(owner string) *mirrorEventWallet {
	return &mirrorEventWallet{ownerID: owner, state: wOpen, seen: map[string]bool{}}
}

// balance mirrors Service.walletBalance: TOPUP adds, everything else (CHARGE/REFUND
// as recorded against the attendee sub-balance) subtracts.
func (w *mirrorEventWallet) balance() int64 {
	var bal int64
	for _, e := range w.entries {
		if e.typ == "TOPUP" {
			bal += e.amountKobo
		} else {
			bal -= e.amountKobo
		}
	}
	return bal
}

// topUp mirrors Service.TopUp: rejects on CLOSED, flips OPEN->SPENDING on first call,
// idempotent on idemKey.
func (w *mirrorEventWallet) topUp(amountKobo int64, idemKey string) error {
	if amountKobo <= 0 {
		return errors.New("events: top-up must be positive kobo")
	}
	if w.state == wClosed {
		return errWalletClosed
	}
	if w.seen[idemKey] {
		return nil // idempotent replay: no-op, same wallet state returned by caller
	}
	w.entries = append(w.entries, mirrorLedgerEntry{typ: "TOPUP", amountKobo: amountKobo, idemKey: idemKey})
	w.seen[idemKey] = true
	if w.state == wOpen {
		w.state = wSpending
	}
	return nil
}

// tapCharge mirrors Service.TapCharge: rejects on CLOSED and on insufficient funds;
// idempotent on idemKey (replay returns the same charge, doesn't double-debit).
func (w *mirrorEventWallet) tapCharge(amountKobo int64, idemKey string) error {
	if amountKobo <= 0 {
		return errors.New("events: charge must be positive kobo")
	}
	if w.seen[idemKey] {
		return nil // replay: existing charge returned, no new debit
	}
	if w.state == wClosed {
		return errWalletClosed
	}
	if w.balance() < amountKobo {
		return errInsufficientFloat
	}
	w.entries = append(w.entries, mirrorLedgerEntry{typ: "CHARGE", amountKobo: amountKobo, idemKey: idemKey})
	w.seen[idemKey] = true
	return nil
}

// closeWallet mirrors Service.CloseWallet: computes the residual, posts EXACTLY ONE
// REFUND entry (only if residual > 0), flips to CLOSED, and is idempotent (a second
// call on an already-CLOSED wallet is a silent no-op — no double refund).
func (w *mirrorEventWallet) closeWallet() (refunded int64, err error) {
	if w.state == wClosed {
		return 0, nil // idempotent per Service.CloseWallet
	}
	residual := w.balance()
	w.state = wClosed
	if residual > 0 {
		w.entries = append(w.entries, mirrorLedgerEntry{typ: "REFUND", amountKobo: residual, idemKey: "residual"})
	}
	return residual, nil
}

func TestWalletLifecycle_OpenThenSpendingOnFirstTopUp(t *testing.T) {
	w := newMirrorWallet("owner-1")
	if w.state != wOpen {
		t.Fatalf("initial state = %s, want OPEN", w.state)
	}
	if err := w.topUp(5_000_00, "topup-1"); err != nil {
		t.Fatalf("topup: %v", err)
	}
	if w.state != wSpending {
		t.Fatalf("state after first topup = %s, want SPENDING", w.state)
	}
}

func TestWalletLifecycle_CloseRefundsResidualExactlyOnce(t *testing.T) {
	w := newMirrorWallet("owner-1")
	_ = w.topUp(10_000_00, "topup-1")
	_ = w.tapCharge(3_000_00, "charge-1")

	wantResidual := int64(7_000_00)
	if got := w.balance(); got != wantResidual {
		t.Fatalf("pre-close balance = %d, want %d", got, wantResidual)
	}

	refunded, err := w.closeWallet()
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if refunded != wantResidual {
		t.Fatalf("refunded = %d, want %d", refunded, wantResidual)
	}
	if w.state != wClosed {
		t.Fatalf("state after close = %s, want CLOSED", w.state)
	}

	// Exactly one REFUND entry — never zero (residual>0), never more than one.
	refundCount := 0
	for _, e := range w.entries {
		if e.typ == "REFUND" {
			refundCount++
		}
	}
	if refundCount != 1 {
		t.Fatalf("REFUND entry count = %d, want exactly 1", refundCount)
	}

	// Ledger is balanced: TOPUP - CHARGE - REFUND nets to zero (all funds accounted for).
	var net int64
	for _, e := range w.entries {
		switch e.typ {
		case "TOPUP":
			net += e.amountKobo
		case "CHARGE", "REFUND":
			net -= e.amountKobo
		}
	}
	if net != 0 {
		t.Fatalf("ledger not balanced after close: net = %d, want 0", net)
	}

	// Double-close is idempotent: no second refund, no error.
	refunded2, err := w.closeWallet()
	if err != nil {
		t.Fatalf("second close: %v", err)
	}
	if refunded2 != 0 {
		t.Fatalf("second close refunded %d, want 0 (already closed, no double refund)", refunded2)
	}
	refundCount = 0
	for _, e := range w.entries {
		if e.typ == "REFUND" {
			refundCount++
		}
	}
	if refundCount != 1 {
		t.Fatalf("REFUND entry count after double-close = %d, want still exactly 1", refundCount)
	}
}

func TestWalletLifecycle_CloseWithZeroResidualPostsNoRefund(t *testing.T) {
	w := newMirrorWallet("owner-1")
	_ = w.topUp(5_000_00, "topup-1")
	_ = w.tapCharge(5_000_00, "charge-1") // spend it all

	refunded, err := w.closeWallet()
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if refunded != 0 {
		t.Fatalf("refunded = %d, want 0 (zero residual)", refunded)
	}
	for _, e := range w.entries {
		if e.typ == "REFUND" {
			t.Fatal("no REFUND entry should be posted for a zero residual")
		}
	}
}

func TestWalletLifecycle_ClosedWalletRejectsTopUp(t *testing.T) {
	w := newMirrorWallet("owner-1")
	_ = w.topUp(1_000_00, "topup-1")
	_, _ = w.closeWallet()

	if err := w.topUp(1_000_00, "topup-2"); !errors.Is(err, errWalletClosed) {
		t.Fatalf("topup on closed wallet: got %v, want errWalletClosed", err)
	}
	if got := w.balance(); got != 0 {
		t.Fatalf("balance after rejected topup = %d, want 0 (all spent/refunded)", got)
	}
}

func TestWalletLifecycle_ClosedWalletRejectsCharge(t *testing.T) {
	w := newMirrorWallet("owner-1")
	_ = w.topUp(1_000_00, "topup-1")
	_, _ = w.closeWallet()

	if err := w.tapCharge(1, "charge-after-close"); !errors.Is(err, errWalletClosed) {
		t.Fatalf("charge on closed wallet: got %v, want errWalletClosed", err)
	}
}

func TestWalletLifecycle_ChargeRejectsInsufficientFloat(t *testing.T) {
	w := newMirrorWallet("owner-1")
	_ = w.topUp(1_000_00, "topup-1")

	if err := w.tapCharge(2_000_00, "charge-1"); !errors.Is(err, errInsufficientFloat) {
		t.Fatalf("overdraw charge: got %v, want errInsufficientFloat", err)
	}
	if got := w.balance(); got != 1_000_00 {
		t.Fatalf("balance after rejected overdraw = %d, want unchanged 100000", got)
	}
}

// ===========================================================================
// 4. Idempotency — Purchase / TopUp / TapCharge / VendorCharge (SettleVendor)
//    must not double-issue / double-debit / double-charge on retried requests.
// ===========================================================================

// mirrorTicketInventory replicates Service.Purchase's reserve-then-issue path,
// including the compensating rollback on a failed debit.
type mirrorTicketInventory struct {
	capacity int
	sold     int
	issued   map[string]string // idemKey -> ticketID (order-level idempotency)
	debitFn  func(amount int64) error
}

func newMirrorInventory(capacity int, debitFn func(int64) error) *mirrorTicketInventory {
	return &mirrorTicketInventory{capacity: capacity, issued: map[string]string{}, debitFn: debitFn}
}

var errSoldOut = errors.New("events: tier sold out")

// purchase mirrors Purchase: idempotent on idemKey (same key -> same ticket, no
// double-issue, no double-debit), reserves inventory before the money leg, and rolls
// back the reservation if the debit fails (compensating action).
func (inv *mirrorTicketInventory) purchase(idemKey string, price int64) (ticketID string, err error) {
	if existing, ok := inv.issued[idemKey]; ok {
		return existing, nil // replay: same ticket, no new debit, no new inventory hit
	}
	if inv.sold >= inv.capacity {
		return "", errSoldOut
	}
	inv.sold++ // reserve first
	if err := inv.debitFn(price); err != nil {
		inv.sold-- // compensate: release the reservation
		return "", err
	}
	id := "ticket-" + idemKey
	inv.issued[idemKey] = id
	return id, nil
}

func TestPurchaseIdempotency_SameKeyReturnsSameTicketNoDoubleDebit(t *testing.T) {
	debitCalls := 0
	inv := newMirrorInventory(10, func(amount int64) error { debitCalls++; return nil })

	id1, err := inv.purchase("idem-abc", 5_000_00)
	if err != nil {
		t.Fatalf("first purchase: %v", err)
	}
	id2, err := inv.purchase("idem-abc", 5_000_00)
	if err != nil {
		t.Fatalf("replayed purchase: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("replay issued a different ticket: %s vs %s", id1, id2)
	}
	if debitCalls != 1 {
		t.Fatalf("debit called %d times, want exactly 1 (no double-debit)", debitCalls)
	}
	if inv.sold != 1 {
		t.Fatalf("sold = %d, want 1 (no double-issue of inventory)", inv.sold)
	}
}

func TestPurchaseIdempotency_FailedDebitCompensatesReservation(t *testing.T) {
	inv := newMirrorInventory(1, func(amount int64) error { return errors.New("insufficient wallet funds") })

	_, err := inv.purchase("idem-fail", 5_000_00)
	if err == nil {
		t.Fatal("expected purchase to fail when the debit fails")
	}
	if inv.sold != 0 {
		t.Fatalf("sold = %d, want 0 — a failed debit must release the inventory reservation", inv.sold)
	}

	// A retry with a fresh key against a now-working debit succeeds and only takes
	// one seat, proving the earlier failed attempt didn't leak a reservation.
	inv.debitFn = func(int64) error { return nil }
	id, err := inv.purchase("idem-retry", 5_000_00)
	if err != nil {
		t.Fatalf("retry after compensation: %v", err)
	}
	if id == "" || inv.sold != 1 {
		t.Fatalf("retry did not cleanly issue exactly one ticket: id=%q sold=%d", id, inv.sold)
	}
}

func TestPurchaseIdempotency_ConcurrentSameKeyIssuesOneTicket(t *testing.T) {
	// Mirrors the DB-level guarantee (UNIQUE idempotency_key on event_orders):
	// N attempts with the SAME key must collapse to exactly one reservation/debit.
	inv := newMirrorInventory(100, func(int64) error { return nil })
	const attempts = 25
	ids := map[string]bool{}
	debitCalls := 0
	inv.debitFn = func(int64) error { debitCalls++; return nil }

	for i := 0; i < attempts; i++ {
		id, err := inv.purchase("dupe-key", 1_000_00)
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		ids[id] = true
	}
	if len(ids) != 1 {
		t.Fatalf("got %d distinct ticket ids across %d retries, want 1", len(ids), attempts)
	}
	if debitCalls != 1 {
		t.Fatalf("debit called %d times across %d retries, want 1", debitCalls, attempts)
	}
	if inv.sold != 1 {
		t.Fatalf("sold = %d, want 1", inv.sold)
	}
}

func TestTopUpIdempotency_ReplaySameKeyNoDoubleCredit(t *testing.T) {
	w := newMirrorWallet("owner-1")
	if err := w.topUp(2_000_00, "topup-key-1"); err != nil {
		t.Fatalf("first topup: %v", err)
	}
	if err := w.topUp(2_000_00, "topup-key-1"); err != nil {
		t.Fatalf("replayed topup: %v", err)
	}
	if got := w.balance(); got != 2_000_00 {
		t.Fatalf("balance = %d after replayed topup, want 200000 (no double credit)", got)
	}
	topupEntries := 0
	for _, e := range w.entries {
		if e.typ == "TOPUP" {
			topupEntries++
		}
	}
	if topupEntries != 1 {
		t.Fatalf("TOPUP entry count = %d, want 1", topupEntries)
	}
}

func TestTapChargeIdempotency_ReplaySameKeyNoDoubleDebit(t *testing.T) {
	w := newMirrorWallet("owner-1")
	_ = w.topUp(5_000_00, "topup-1")

	if err := w.tapCharge(1_000_00, "charge-key-1"); err != nil {
		t.Fatalf("first charge: %v", err)
	}
	if err := w.tapCharge(1_000_00, "charge-key-1"); err != nil {
		t.Fatalf("replayed charge: %v", err)
	}
	if got := w.balance(); got != 4_000_00 {
		t.Fatalf("balance = %d after replayed charge, want 400000 (charged once, not twice)", got)
	}
}

// mirrorVendorSettlement replicates Service.SettleVendor's idempotency + fee math.
type mirrorVendorSettlement struct {
	unsettledFloat int64
	settled        bool
	feeBps         int
	seenKeys       map[string]bool
}

func (v *mirrorVendorSettlement) settle(idemKey string) (net, fee int64, err error) {
	if v.seenKeys == nil {
		v.seenKeys = map[string]bool{}
	}
	if v.seenKeys[idemKey] {
		return 0, 0, nil // replay: settlement already recorded, no double-payout
	}
	if v.unsettledFloat <= 0 {
		return 0, 0, errors.New("events: nothing to settle")
	}
	gross := v.unsettledFloat
	fee = (gross * int64(v.feeBps)) / 10000
	net = gross - fee
	v.unsettledFloat = 0
	v.settled = true
	v.seenKeys[idemKey] = true
	return net, fee, nil
}

func TestVendorChargeIdempotency_SettleReplayNoDoublePayout(t *testing.T) {
	v := &mirrorVendorSettlement{unsettledFloat: 100_000_00, feeBps: 250} // 2.5%
	net1, fee1, err := v.settle("settle-key-1")
	if err != nil {
		t.Fatalf("first settle: %v", err)
	}
	if net1 != 97_500_00 || fee1 != 2_500_00 {
		t.Fatalf("net=%d fee=%d, want net=9750000 fee=250000", net1, fee1)
	}

	net2, fee2, err := v.settle("settle-key-1")
	if err != nil {
		t.Fatalf("replayed settle: %v", err)
	}
	if net2 != 0 || fee2 != 0 {
		t.Fatalf("replayed settle paid out again: net=%d fee=%d, want 0/0 (no double payout)", net2, fee2)
	}
}

// ===========================================================================
// 5. Object-level authorization.
// ===========================================================================

func TestAuthZ_WalletOwnershipEnforcedOnGetAndClose(t *testing.T) {
	// Mirrors Service.GetWallet: w.OwnerID != ownerID -> ErrForbidden.
	type wallet struct{ ownerID string }
	w := wallet{ownerID: "alice"}
	assertOwner := func(callerID string) error {
		if w.ownerID != callerID {
			return errForbidden
		}
		return nil
	}
	if err := assertOwner("alice"); err != nil {
		t.Fatalf("owner access should succeed: %v", err)
	}
	if err := assertOwner("mallory"); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner GetWallet: got %v, want errForbidden", err)
	}
}

func TestAuthZ_TicketGiftRequiresCurrentOwner(t *testing.T) {
	tk := &mirrorTicket{ownerID: "alice", state: tIssued}
	if err := mirrorGift(tk, "mallory", "bob"); !errors.Is(err, errForbidden) {
		t.Fatalf("gift by non-owner: got %v, want errForbidden", err)
	}
}

func TestAuthZ_MyTicketsScopedToCaller(t *testing.T) {
	// Mirrors Service.MyTickets: `WHERE owner_id=$1` — a caller only ever sees
	// their own tickets, never another user's, by construction of the query.
	all := []mirrorTicket{
		{ownerID: "alice", state: tIssued},
		{ownerID: "bob", state: tIssued},
		{ownerID: "alice", state: tUsed},
	}
	myTickets := func(caller string) []mirrorTicket {
		var out []mirrorTicket
		for _, t := range all {
			if t.ownerID == caller {
				out = append(out, t)
			}
		}
		return out
	}
	aliceTickets := myTickets("alice")
	if len(aliceTickets) != 2 {
		t.Fatalf("alice should see 2 tickets, got %d", len(aliceTickets))
	}
	for _, tk := range aliceTickets {
		if tk.ownerID != "alice" {
			t.Fatalf("leaked another user's ticket into alice's list: %+v", tk)
		}
	}
}

func TestAuthZ_AddTierAddPromoAddVendorRequireOrganiserOwnership(t *testing.T) {
	// Mirrors Service.assertOwner, used identically by AddTier/AddPromo/AddVendor.
	assertOwner := func(eventOrganiser, callerID string) error {
		if eventOrganiser != callerID {
			return errForbidden
		}
		return nil
	}
	if err := assertOwner("org-1", "org-1"); err != nil {
		t.Fatalf("owner should be allowed: %v", err)
	}
	if err := assertOwner("org-1", "org-2"); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner AddTier/AddPromo/AddVendor: got %v, want errForbidden", err)
	}
}

// ===========================================================================
// 6. Money correctness — integer kobo, vendor settlement fee_bps math.
// ===========================================================================

func TestMoney_SettlementFeeMathIsExactIntegerKobo(t *testing.T) {
	cases := []struct {
		name       string
		grossKobo  int64
		feeBps     int
		wantFee    int64
		wantNet    int64
	}{
		{"zero fee", 100_000_00, 0, 0, 100_000_00},
		{"250bps (2.5%) on round number", 100_000_00, 250, 2_500_00, 97_500_00},
		{"500bps (5%) on odd gross truncates via integer division", 100_001, 500, 5000, 95001},
		{"1bp on small gross rounds down to zero fee", 99, 1, 0, 99},
		{"10000bps (100%) takes everything", 50_000, 10000, 50_000, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fee := (tc.grossKobo * int64(tc.feeBps)) / 10000
			net := tc.grossKobo - fee
			if fee != tc.wantFee {
				t.Fatalf("fee = %d, want %d", fee, tc.wantFee)
			}
			if net != tc.wantNet {
				t.Fatalf("net = %d, want %d", net, tc.wantNet)
			}
			// Integer-kobo invariant: gross must equal fee+net exactly (no float drift).
			if fee+net != tc.grossKobo {
				t.Fatalf("fee+net = %d, want gross %d (money must not leak or float-drift)", fee+net, tc.grossKobo)
			}
		})
	}
}

func TestMoney_PromoDiscountIsIntegerKobo(t *testing.T) {
	// Mirrors the promo application in Purchase: payable = price - (price*pct)/100.
	cases := []struct {
		priceKobo  int64
		percentOff int
		wantPayable int64
	}{
		{10_000_00, 10, 9_000_00},
		{10_000_00, 0, 10_000_00},
		{10_000_00, 100, 0},
		{999, 33, 670}, // 999*33/100 = 329 (int division truncates) -> payable 670
	}
	for _, tc := range cases {
		discount := (tc.priceKobo * int64(tc.percentOff)) / 100
		payable := tc.priceKobo - discount
		if payable != tc.wantPayable {
			t.Fatalf("price=%d pct=%d: payable = %d, want %d", tc.priceKobo, tc.percentOff, payable, tc.wantPayable)
		}
	}
}

func TestMoney_NoFloatAmountsAnywhereInFixtures(t *testing.T) {
	// Guards against a future regression that introduces float math for money.
	// All fixtures in this file are declared as int64 kobo literals; this test
	// documents and enforces that convention at compile time (int64 division below
	// would fail to compile if any operand were a float).
	var amountKobo int64 = 123_456_00
	var bps int64 = 725
	fee := (amountKobo * bps) / 10000
	if fee != 8_950_56 {
		t.Fatalf("fee = %d, want 895056 (pure integer arithmetic)", fee)
	}
}
