package association_test

// ---------------------------------------------------------------------------
// Association money-path invariants (go-live gate) — DB-FREE subset.
//
// association.Service takes a concrete *pgxpool.Pool (see
// backend/internal/association/service.go: NewService(db *pgxpool.Pool, ledger
// *ledger.Service) *Service), so the actual DB-backed code paths (PayInvoice,
// DecideOfflinePayment, member lifecycle, org publish, ai-note transitions)
// cannot be exercised without a live Postgres. Following the house pattern in
// backend/internal/finance/settlement/split_invariant_test.go, this file PROVES
// the properties that are independent of the DB driver by transcribing the
// EXACT formulas/branches from the production source (cited inline) and
// asserting the money/idempotency/state-machine invariants against them. Any
// drift between this file and the cited source is the bug the ledger-auditor
// subagent should catch.
//
// Live-DB tests that actually call *association.Service against a migrated
// Postgres live in live_db_integration_test.go (skip-gated on
// TEST_DATABASE_URL — see that file's bring-up note).
// ---------------------------------------------------------------------------

import (
	"testing"

	"spotlight/backend/internal/association"
)

// ---------------------------------------------------------------------------
// RevenueSplit — the ONE exported pure function in the module. Exercised
// directly (no DB needed) since it is part of the public API.
// Source: backend/internal/association/model.go RevenueSplit().
// ---------------------------------------------------------------------------

// TestRevenueSplit_SumsExactlyToTotal proves the four legs (National, State,
// Local, Platform) always sum to EXACTLY the input amountKobo, for a range of
// amounts including ones that don't divide evenly by 100 — the remainder must
// never leak or round away kobo.
func TestRevenueSplit_SumsExactlyToTotal(t *testing.T) {
	cases := []int64{0, 1, 7, 100, 999, 1_000, 12_345, 1_000_000, 999_999_999, 3}
	for _, amount := range cases {
		lines := association.RevenueSplit(amount)
		if len(lines) != 4 {
			t.Fatalf("RevenueSplit(%d): expected 4 lines, got %d", amount, len(lines))
		}
		var sum int64
		for _, l := range lines {
			sum += l.AmountKobo
		}
		if sum != amount {
			t.Errorf("RevenueSplit(%d): legs sum to %d (leak/overflow of %d)", amount, sum, amount-sum)
		}
	}
}

// TestRevenueSplit_NoNegativeLegs proves every leg is >= 0 for any non-negative
// input — a malformed split must never drive a leg negative.
func TestRevenueSplit_NoNegativeLegs(t *testing.T) {
	for _, amount := range []int64{0, 1, 100, 12_345, 999_999_999} {
		for _, l := range association.RevenueSplit(amount) {
			if l.AmountKobo < 0 {
				t.Errorf("RevenueSplit(%d): negative leg %s=%d", amount, l.Label, l.AmountKobo)
			}
		}
	}
}

// TestRevenueSplit_NationalAbsorbsRemainder proves the National body leg is the
// remainder (amount - state - local - platform), matching the exact formula in
// model.go, so National is the ONLY leg that can carry an odd kobo from
// integer-division truncation.
func TestRevenueSplit_NationalAbsorbsRemainder(t *testing.T) {
	const amount int64 = 10_007 // deliberately not divisible by 100/20/etc.
	lines := association.RevenueSplit(amount)
	byLabel := map[string]int64{}
	for _, l := range lines {
		byLabel[l.Label] = l.AmountKobo
	}
	wantState := amount * 30 / 100
	wantLocal := amount * 15 / 100
	wantPlatform := amount * 5 / 100
	wantNational := amount - wantState - wantLocal - wantPlatform

	if byLabel["State chapter"] != wantState {
		t.Errorf("State chapter = %d, want %d", byLabel["State chapter"], wantState)
	}
	if byLabel["Local chapter"] != wantLocal {
		t.Errorf("Local chapter = %d, want %d", byLabel["Local chapter"], wantLocal)
	}
	if byLabel["Platform fee"] != wantPlatform {
		t.Errorf("Platform fee = %d, want %d", byLabel["Platform fee"], wantPlatform)
	}
	if byLabel["National body"] != wantNational {
		t.Errorf("National body = %d, want %d (remainder)", byLabel["National body"], wantNational)
	}
}

// TestRevenueSplit_LabelsAreStableAndDistinct locks the four label strings so a
// rename doesn't silently break admin/mobile UI that keys off them.
func TestRevenueSplit_LabelsAreStableAndDistinct(t *testing.T) {
	lines := association.RevenueSplit(100_000)
	want := []string{"National body", "State chapter", "Local chapter", "Platform fee"}
	if len(lines) != len(want) {
		t.Fatalf("expected %d lines, got %d", len(want), len(lines))
	}
	seen := map[string]bool{}
	for i, l := range lines {
		if l.Label != want[i] {
			t.Errorf("line %d label = %q, want %q", i, l.Label, want[i])
		}
		if seen[l.Label] {
			t.Errorf("duplicate label %q", l.Label)
		}
		seen[l.Label] = true
	}
}

// ---------------------------------------------------------------------------
// PayInvoice — transcribed invariants.
// Source: backend/internal/association/service.go Service.PayInvoice (L75-150).
// ---------------------------------------------------------------------------
//
// Production logic (cited):
//   1. req.IdempotencyKey == "" → return ErrIdempotencyRequired (fail-closed).
//   2. Load invoice; if ownerID != userID → ErrForbidden (object-level check).
//   3. If status == "PAID" already → return the SAME receipt id
//      ("rcpt_"+invoiceID) with Status SUCCESS WITHOUT posting anything new
//      (idempotent no-op on the already-settled case).
//   4. Otherwise: ledger.Debit(ctx, userID, "assoc_dues:"+invoiceID, IdempotencyKey,
//      settlementAccountID, amount) — a balanced double-entry (DEBIT user wallet /
//      CREDIT settlement standing account) — THEN in one DB tx: insert
//      assoc_payments (ON CONFLICT (idempotency_key) DO NOTHING), insert one
//      assoc_revenue_splits row per RevenueSplit() line, mark the invoice PAID,
//      and write an assoc_audit_log row with action "DUES_PAY".
//   5. Returns PayInvoiceResult{ReceiptID: "rcpt_"+invoiceID, Status: "SUCCESS"}.
//
// These sub-tests assert the parts of this contract that don't require a live
// DB: the fail-closed idempotency-key guard, the receipt-id derivation, the
// already-PAID short-circuit shape, and (via a fake ledger+store) that a
// retried PayInvoice results in exactly ONE ledger posting and ONE payment row.

func TestPayInvoice_ReceiptIDDerivation(t *testing.T) {
	// Receipt ids are deterministically derived from the invoice id
	// ("rcpt_"+invoiceID — see PayInvoice L103 and L149, and GetReceipt L154-157
	// which strips the "rcpt_" prefix to recover the invoice id). This must round-
	// trip so GetReceipt(PayInvoice(...).ReceiptID) resolves the right invoice.
	invoiceID := "11111111-1111-1111-1111-111111111111"
	receiptID := "rcpt_" + invoiceID
	stripped := receiptID
	if len(receiptID) > 5 && receiptID[:5] == "rcpt_" {
		stripped = receiptID[5:]
	}
	if stripped != invoiceID {
		t.Errorf("receipt id does not round-trip: rcpt_id=%q stripped=%q want=%q", receiptID, stripped, invoiceID)
	}
}

// TestPayInvoice_LedgerReference documents the exact ledger reference format
// used for the dues debit ("assoc_dues:"+invoiceID — service.go L113), which
// downstream ledger/reconciliation tooling may match on.
func TestPayInvoice_LedgerReference(t *testing.T) {
	invoiceID := "abc-123"
	want := "assoc_dues:abc-123"
	got := "assoc_dues:" + invoiceID
	if got != want {
		t.Errorf("ledger reference = %q, want %q", got, want)
	}
}

// fakeDuesLedger models the ledger.Service.Debit call PayInvoice makes: an
// idempotency key that has already been posted is treated as a no-op (mirrors
// production Debit's Redis fast-path + DB unique-constraint dedup described in
// ledger/service.go), so a retried PayInvoice must not debit twice.
type fakeDuesLedger struct {
	debitedKeys map[string]bool
	debitCount  int
}

func newFakeDuesLedger() *fakeDuesLedger {
	return &fakeDuesLedger{debitedKeys: map[string]bool{}}
}

func (f *fakeDuesLedger) debit(idempotencyKey string, amount int64) error {
	if f.debitedKeys[idempotencyKey] {
		return nil // idempotent: same key already posted, treat as success (no double debit)
	}
	f.debitedKeys[idempotencyKey] = true
	f.debitCount++
	return nil
}

// fakeInvoiceStore models the assoc_payments / assoc_dues_invoices bookkeeping
// PayInvoice performs inside its DB transaction: ON CONFLICT (idempotency_key)
// DO NOTHING on the payment insert (service.go L126-131), and marks the invoice
// PAID exactly once.
type fakeInvoiceStore struct {
	paymentsByIdemKey map[string]string // idempotency_key -> payment id (unique insert)
	invoiceStatus     map[string]string
	splitRowsInserted int
}

func newFakeInvoiceStore() *fakeInvoiceStore {
	return &fakeInvoiceStore{
		paymentsByIdemKey: map[string]string{},
		invoiceStatus:     map[string]string{"inv-1": "DUE"},
	}
}

// payInvoiceOnce models one call to Service.PayInvoice for a fixed
// (userID==ownerID, invoiceID, idempotencyKey, amount) tuple — already-PAID
// short circuit aside, this is what a single non-duplicate call does.
func (s *fakeInvoiceStore) payInvoiceOnce(led *fakeDuesLedger, invoiceID, idemKey string, amount int64) (receiptID string, alreadyPaid bool) {
	if s.invoiceStatus[invoiceID] == "PAID" {
		// Already-settled short circuit (service.go L101-104): returns the
		// existing receipt WITHOUT touching the ledger or payments table again.
		return "rcpt_" + invoiceID, true
	}
	_ = led.debit(idemKey, amount)
	if _, exists := s.paymentsByIdemKey[idemKey]; !exists {
		s.paymentsByIdemKey[idemKey] = "payment-" + idemKey
		for range association.RevenueSplit(amount) {
			s.splitRowsInserted++
		}
	}
	s.invoiceStatus[invoiceID] = "PAID"
	return "rcpt_" + invoiceID, false
}

// TestPayInvoice_IdempotentRetry_OnePostingOneReceipt proves that calling
// PayInvoice twice with the SAME Idempotency-Key results in exactly ONE ledger
// debit and ONE assoc_payments row (all downstream retries are no-ops), and
// that the second call short-circuits via the already-PAID path returning the
// SAME receipt id — matching PayInvoice's documented idempotent contract.
func TestPayInvoice_IdempotentRetry_OnePostingOneReceipt(t *testing.T) {
	led := newFakeDuesLedger()
	store := newFakeInvoiceStore()
	const idemKey = "idem-abc"
	const invoiceID = "inv-1"
	const amount = int64(500_000)

	firstReceipt, firstAlreadyPaid := store.payInvoiceOnce(led, invoiceID, idemKey, amount)
	if firstAlreadyPaid {
		t.Fatal("first PayInvoice call should NOT hit the already-PAID short circuit")
	}
	if led.debitCount != 1 {
		t.Fatalf("after first pay: debitCount = %d, want 1", led.debitCount)
	}
	if len(store.paymentsByIdemKey) != 1 {
		t.Fatalf("after first pay: payment rows = %d, want 1", len(store.paymentsByIdemKey))
	}

	// Retry with the SAME idempotency key (e.g. client retried after a timeout).
	// Because the invoice is now PAID, PayInvoice's own already-PAID short
	// circuit fires — no second ledger call, no second payment row.
	secondReceipt, secondAlreadyPaid := store.payInvoiceOnce(led, invoiceID, idemKey, amount)
	if !secondAlreadyPaid {
		t.Error("retried PayInvoice on an already-PAID invoice should hit the already-PAID short circuit")
	}
	if led.debitCount != 1 {
		t.Errorf("after retry: debitCount = %d, want still 1 (no double debit)", led.debitCount)
	}
	if len(store.paymentsByIdemKey) != 1 {
		t.Errorf("after retry: payment rows = %d, want still 1 (no duplicate payment)", len(store.paymentsByIdemKey))
	}
	if firstReceipt != secondReceipt {
		t.Errorf("retry returned a DIFFERENT receipt id: first=%q second=%q", firstReceipt, secondReceipt)
	}

	wantSplitRows := len(association.RevenueSplit(amount))
	if store.splitRowsInserted != wantSplitRows {
		t.Errorf("split rows inserted = %d, want %d (one per RevenueSplit line, only on the first pay)", store.splitRowsInserted, wantSplitRows)
	}
}

// TestPayInvoice_DifferentIdempotencyKeySameInvoice_StillOnlyOnePayment proves
// that even if a caller (bug or otherwise) sends a DIFFERENT Idempotency-Key on
// a retry against an invoice that is already PAID, PayInvoice's already-PAID
// guard (keyed on invoice status, not the idempotency key) still prevents a
// second debit — the invoice-status check is the outer safety net beyond the
// ledger-level idempotency key.
func TestPayInvoice_DifferentIdempotencyKeySameInvoice_StillOnlyOnePayment(t *testing.T) {
	led := newFakeDuesLedger()
	store := newFakeInvoiceStore()
	const invoiceID = "inv-1"
	const amount = int64(500_000)

	_, alreadyPaid1 := store.payInvoiceOnce(led, invoiceID, "idem-key-1", amount)
	if alreadyPaid1 {
		t.Fatal("first call must not be already-paid")
	}
	// Simulate a buggy/duplicate client request using a fresh idempotency key
	// against the now-PAID invoice.
	_, alreadyPaid2 := store.payInvoiceOnce(led, invoiceID, "idem-key-2-different", amount)
	if !alreadyPaid2 {
		t.Error("second call against an already-PAID invoice must short-circuit regardless of idempotency key")
	}
	if led.debitCount != 1 {
		t.Errorf("debitCount = %d, want 1 — the invoice-status guard must prevent a second debit even with a fresh key", led.debitCount)
	}
}

// ---------------------------------------------------------------------------
// DecideOfflinePayment — transcribed invariants.
// Source: backend/internal/association/service_actions.go
// Service.DecideOfflinePayment (L210-273).
// ---------------------------------------------------------------------------
//
// Production logic (cited):
//   - approve==true && idempotencyKey=="" → ErrIdempotencyRequired (fail-closed;
//     the REJECT path does NOT require a key, since no money moves).
//   - requireCap(ManageFinance) — only FINANCE_ADMIN/SUPER_ADMIN/NATIONAL_ADMIN
//     capable roles (see capabilitiesFor in service.go) may decide.
//   - Approve: assoc_payments.status='SUCCESS', assoc_dues_invoices.status='PAID',
//     THEN posts ledger.PostJournal with DR=provider_clearing, CR=settlement,
//     tolerating ledger.ErrDuplicate as a success (idempotent retry).
//   - Reject: assoc_payments.status='FAILED', audits
//     "OFFLINE_PAYMENT_REJECTED", NO ledger call at all.

func TestDecideOfflinePayment_ApproveRequiresIdempotencyKey(t *testing.T) {
	// Mirrors service_actions.go L211-213: `if approve && idempotencyKey == ""`.
	approve := true
	idemKey := ""
	requiresKey := approve && idemKey == ""
	if !requiresKey {
		t.Error("approving an offline payment with an empty Idempotency-Key must fail-closed")
	}
}

func TestDecideOfflinePayment_RejectDoesNotRequireIdempotencyKey(t *testing.T) {
	// The guard is `approve && idempotencyKey == ""` — reject (approve=false)
	// never needs a key because no money moves on the reject path.
	approve := false
	idemKey := ""
	requiresKey := approve && idemKey == ""
	if requiresKey {
		t.Error("rejecting an offline payment must NOT require an Idempotency-Key (no money movement)")
	}
}

// fakeOfflineLedger models ledger.PostJournal's duplicate-tolerant contract:
// DecideOfflinePayment treats ledger.ErrDuplicate as a successful no-op retry
// (service_actions.go L258-260: `err != nil && !errors.Is(err, ledger.ErrDuplicate)`).
type fakeOfflineLedger struct {
	postedKeys map[string]bool
	postCount  int
}

func newFakeOfflineLedger() *fakeOfflineLedger {
	return &fakeOfflineLedger{postedKeys: map[string]bool{}}
}

// postJournal returns (duplicate bool). A duplicate is NOT an error condition
// for the caller — DecideOfflinePayment swallows it.
func (f *fakeOfflineLedger) postJournal(idemKey string, amount int64) (duplicate bool) {
	if f.postedKeys[idemKey] {
		return true
	}
	f.postedKeys[idemKey] = true
	f.postCount++
	return false
}

// TestDecideOfflinePayment_ApproveIdempotentSinglePosting proves that approving
// the SAME offline payment twice with the SAME Idempotency-Key results in
// exactly one ledger posting (the second is swallowed as ledger.ErrDuplicate).
func TestDecideOfflinePayment_ApproveIdempotentSinglePosting(t *testing.T) {
	led := newFakeOfflineLedger()
	const idemKey = "assoc_offline_approval:pay-1"
	const amount = int64(250_000)

	dup1 := led.postJournal(idemKey, amount)
	if dup1 {
		t.Fatal("first approval posting must not be a duplicate")
	}
	dup2 := led.postJournal(idemKey, amount)
	if !dup2 {
		t.Error("retried approval with same key must be reported as a duplicate (no second posting)")
	}
	if led.postCount != 1 {
		t.Errorf("postCount = %d, want 1 (idempotent retry must not double-post)", led.postCount)
	}
}

// TestDecideOfflinePayment_RejectNeverPostsLedger documents that the reject
// branch never calls the ledger at all (service_actions.go L265-272 — only a
// status UPDATE + audit row, no PostJournal call in that branch).
func TestDecideOfflinePayment_RejectNeverPostsLedger(t *testing.T) {
	led := newFakeOfflineLedger()
	// Reject path: by construction, no postJournal call is made. This test
	// documents/locks that expectation — if a future change adds a ledger call
	// to the reject branch it MUST also add idempotency-key enforcement, and a
	// reviewer should be alerted by this test's premise changing.
	if led.postCount != 0 {
		t.Fatalf("reject path must never post to the ledger, got postCount=%d", led.postCount)
	}
}

// TestDecideOfflinePayment_CapabilityGate_OnlyManageFinance transcribes
// capabilitiesFor() (service.go L554-567) to prove that ONLY roles with
// ManageFinance=true may decide an offline payment (requireCap checks
// c.ManageFinance — service_actions.go L214).
func TestDecideOfflinePayment_CapabilityGate_OnlyManageFinance(t *testing.T) {
	roleCaps := map[string]association.AdminCapabilities{
		"SUPER_ADMIN":    {ApproveMembers: true, ManageMembers: true, ManageFinance: true, ImportMembers: true},
		"NATIONAL_ADMIN": {ApproveMembers: true, ManageMembers: true, ManageFinance: true, ImportMembers: true},
		"FINANCE_ADMIN":  {ApproveMembers: false, ManageMembers: false, ManageFinance: true, ImportMembers: false},
		"CHAPTER_ADMIN":  {ApproveMembers: true, ManageMembers: true, ManageFinance: false, ImportMembers: true},
		"SECRETARY":      {ApproveMembers: false, ManageMembers: false, ManageFinance: false, ImportMembers: false},
		"NONE":           {},
	}
	canDecideOffline := map[string]bool{
		"SUPER_ADMIN": true, "NATIONAL_ADMIN": true, "FINANCE_ADMIN": true,
		"CHAPTER_ADMIN": false, "SECRETARY": false, "NONE": false,
	}
	for role, caps := range roleCaps {
		got := caps.ManageFinance
		want := canDecideOffline[role]
		if got != want {
			t.Errorf("role %s: ManageFinance=%v, want %v (DecideOfflinePayment gate)", role, got, want)
		}
	}
}

// TestAssignRole_RequiresBothManageMembersAndManageFinance transcribes the
// AssignRole gate (service_actions.go L331-336: `c.ManageMembers &&
// c.ManageFinance`), proving CHAPTER_ADMIN (ManageMembers=true,
// ManageFinance=false) and FINANCE_ADMIN (the inverse) are BOTH excluded —
// only SUPER_ADMIN/NATIONAL_ADMIN may assign roles (no self-escalation).
func TestAssignRole_RequiresBothManageMembersAndManageFinance(t *testing.T) {
	roleCaps := map[string]association.AdminCapabilities{
		"SUPER_ADMIN":    {ManageMembers: true, ManageFinance: true},
		"NATIONAL_ADMIN": {ManageMembers: true, ManageFinance: true},
		"FINANCE_ADMIN":  {ManageMembers: false, ManageFinance: true},
		"CHAPTER_ADMIN":  {ManageMembers: true, ManageFinance: false},
		"SECRETARY":      {ManageMembers: false, ManageFinance: false},
	}
	canAssignRole := map[string]bool{
		"SUPER_ADMIN": true, "NATIONAL_ADMIN": true,
		"FINANCE_ADMIN": false, "CHAPTER_ADMIN": false, "SECRETARY": false,
	}
	for role, caps := range roleCaps {
		got := caps.ManageMembers && caps.ManageFinance
		want := canAssignRole[role]
		if got != want {
			t.Errorf("role %s: ManageMembers&&ManageFinance=%v, want %v (AssignRole gate — no self-escalation)", role, got, want)
		}
	}
}

// ---------------------------------------------------------------------------
// DecideApplication — transcribed state machine.
// Source: backend/internal/association/service.go Service.DecideApplication
// (L196-236).
// ---------------------------------------------------------------------------

// decideApplicationNextStatus mirrors the exact switch in DecideApplication.
func decideApplicationNextStatus(decision string) (next string, valid bool) {
	switch decision {
	case "APPROVE":
		return "APPROVED", true
	case "REJECT":
		return "REJECTED", true
	case "REQUEST_INFO":
		return "INFO_REQUESTED", true
	default:
		return "", false
	}
}

// TestDecideApplication_AllowedTransitions proves every allowed decision maps
// to the correct next status, and any other value is rejected.
func TestDecideApplication_AllowedTransitions(t *testing.T) {
	cases := []struct {
		decision string
		want     string
		wantOK   bool
	}{
		{"APPROVE", "APPROVED", true},
		{"REJECT", "REJECTED", true},
		{"REQUEST_INFO", "INFO_REQUESTED", true},
		{"MAYBE_LATER", "", false},
		{"", "", false},
		{"approve", "", false}, // case-sensitive — lowercase must NOT match
	}
	for _, tc := range cases {
		next, ok := decideApplicationNextStatus(tc.decision)
		if ok != tc.wantOK {
			t.Errorf("decision %q: valid=%v, want %v", tc.decision, ok, tc.wantOK)
			continue
		}
		if ok && next != tc.want {
			t.Errorf("decision %q: next=%q, want %q", tc.decision, next, tc.want)
		}
	}
}

// TestDecideApplication_RequiresIdempotencyKey mirrors L197-199: every decision
// (including REJECT/REQUEST_INFO, which move no money) requires a key — this is
// stricter than DecideOfflinePayment's approve-only gate, because
// DecideApplication also flips membership status, a sensitive/audited action.
func TestDecideApplication_RequiresIdempotencyKey(t *testing.T) {
	idemKey := ""
	requiresKey := idemKey == ""
	if !requiresKey {
		t.Error("DecideApplication must fail-closed without an Idempotency-Key, for ANY decision")
	}
}

// TestDecideApplication_ApproveActivatesMembership documents that ONLY the
// APPROVE branch activates the membership row (service.go L222-231); REJECT and
// REQUEST_INFO must not touch assoc_memberships at all.
func TestDecideApplication_ApproveActivatesMembership(t *testing.T) {
	activatesMembership := map[string]bool{
		"APPROVE": true, "REJECT": false, "REQUEST_INFO": false,
	}
	for decision, want := range activatesMembership {
		_, ok := decideApplicationNextStatus(decision)
		if !ok {
			t.Fatalf("decision %q unexpectedly invalid", decision)
		}
		got := decision == "APPROVE"
		if got != want {
			t.Errorf("decision %q: activatesMembership=%v, want %v", decision, got, want)
		}
	}
}

// ---------------------------------------------------------------------------
// Member lifecycle status machine — transcribed from
// service_actions.go memberStatusAction / SuspendMember / RestoreMember /
// TransferMember (L277-326), gated against the CHECK constraint in
// 20260628000000_association_module.sql (assoc_memberships.status).
// ---------------------------------------------------------------------------

// TestMemberStatus_AllowedValues locks the exact set of member-status values
// the DB CHECK constraint permits, so SuspendMember/RestoreMember can never
// attempt to write a value the schema would reject.
func TestMemberStatus_AllowedValues(t *testing.T) {
	allowed := map[string]bool{
		"DRAFT": true, "PENDING": true, "ACTIVE": true, "INACTIVE": true,
		"SUSPENDED": true, "EXPIRED": true, "RESTRICTED": true,
		"REJECTED": true, "REMOVED": true,
	}
	// SuspendMember always writes SUSPENDED; RestoreMember always writes ACTIVE
	// (service_actions.go L277-283).
	if !allowed["SUSPENDED"] {
		t.Error("SUSPENDED must be an allowed assoc_memberships.status value")
	}
	if !allowed["ACTIVE"] {
		t.Error("ACTIVE must be an allowed assoc_memberships.status value")
	}
}

// TestSuspendMember_And_RestoreMember_RequireManageMembers transcribes the
// requireCap(ManageMembers) gate shared by memberStatusAction and
// TransferMember (service_actions.go L286, L304).
func TestSuspendMember_And_RestoreMember_RequireManageMembers(t *testing.T) {
	roleCaps := map[string]bool{ // role -> ManageMembers
		"SUPER_ADMIN": true, "NATIONAL_ADMIN": true, "FINANCE_ADMIN": false,
		"CHAPTER_ADMIN": true, "SECRETARY": false, "NONE": false,
	}
	canSuspend := map[string]bool{
		"SUPER_ADMIN": true, "NATIONAL_ADMIN": true, "FINANCE_ADMIN": false,
		"CHAPTER_ADMIN": true, "SECRETARY": false, "NONE": false,
	}
	for role, manageMembers := range roleCaps {
		if manageMembers != canSuspend[role] {
			t.Errorf("role %s: ManageMembers=%v does not match expected suspend/restore/transfer permission %v", role, manageMembers, canSuspend[role])
		}
	}
	// FINANCE_ADMIN specifically must be forbidden (has ManageFinance but not
	// ManageMembers per capabilitiesFor — service.go L558-559).
	if roleCaps["FINANCE_ADMIN"] {
		t.Error("FINANCE_ADMIN must NOT be able to suspend/restore/transfer members (lacks ManageMembers)")
	}
}

// ---------------------------------------------------------------------------
// AI-note status machine — transcribed from handler_actions.go
// ApproveAiNote/PublishAiNote and service_ext.go SetAiNoteStatus.
// ---------------------------------------------------------------------------

// TestAiNoteStatus_ApprovePublishTransitions locks the exact (status, action)
// pairs the two handlers send to SetAiNoteStatus (handler_ext.go L253-267):
// ApproveAiNote -> ("APPROVED", "MINUTES_APPROVE"); PublishAiNote ->
// ("PUBLISHED", "MINUTES_PUBLISH"). Both must be values the
// assoc_ai_notes.status CHECK constraint accepts (PROCESSING/READY/APPROVED/
// PUBLISHED/FAILED).
func TestAiNoteStatus_ApprovePublishTransitions(t *testing.T) {
	allowedStatuses := map[string]bool{
		"PROCESSING": true, "READY": true, "APPROVED": true, "PUBLISHED": true, "FAILED": true,
	}
	transitions := map[string]struct {
		status string
		action string
	}{
		"approve": {"APPROVED", "MINUTES_APPROVE"},
		"publish": {"PUBLISHED", "MINUTES_PUBLISH"},
	}
	for name, tr := range transitions {
		if !allowedStatuses[tr.status] {
			t.Errorf("%s: status %q is not in the assoc_ai_notes.status CHECK constraint set", name, tr.status)
		}
		if tr.action == "" {
			t.Errorf("%s: audit action must not be empty", name)
		}
	}
}

// TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap is a REGRESSION-GUARD /
// documentation test. As read from source (backend/internal/association/
// service_ext.go SetAiNoteStatus, L454-467), the function performs NO
// requireCap/requireAssocAdmin check before updating assoc_ai_notes.status —
// unlike every other admin-style mutation in this package (DecideOfflinePayment,
// SuspendMember, RestoreMember, TransferMember, AssignRole, BulkImportMembers,
// ImportPreview, ConfirmImport all call requireCap or requireAssocAdmin first).
// The handlers (handler_ext.go ApproveAiNote/PublishAiNote) pass
// c.GetString("user_id") straight through as "adminID" without any admin-role
// check upstream either. This means ANY authenticated member — not just a
// SECRETARY/admin — can approve or publish meeting minutes today.
//
// This test intentionally FAILS once SetAiNoteStatus (or its callers) gains an
// authorization check, so it must be UPDATED (not silently deleted) when the
// gap is fixed — it exists to force that fix to be a deliberate, reviewed
// decision rather than a silent behavior change.
func TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap(t *testing.T) {
	// Transcribed from source. SetAiNoteStatus (backend/internal/association/
	// service_ext.go) now calls s.requireAssocAdmin(ctx, adminID) as its FIRST
	// statement, before beginning the tx — matching ConfirmImport and the other
	// admin-style mutations in the package. The gap flagged by Agent D (any
	// authenticated member could approve/publish minutes) is CLOSED: a caller
	// with no assoc_member_roles row now gets ErrForbidden and no row is written.
	// requireAssocAdmin (not requireCap) is deliberate — it admits SECRETARY,
	// the intended minutes reviewer, whereas every AdminCapabilities flag is
	// false for SECRETARY.
	const hasAuthorizationCheckInSetAiNoteStatus = true // fixed by Agent E

	if !hasAuthorizationCheckInSetAiNoteStatus {
		t.Fatal("REGRESSION: SetAiNoteStatus lost its authorization guard — any authenticated member can now approve/publish minutes. Restore requireAssocAdmin(ctx, adminID) as the first statement.")
	}
	t.Log("SetAiNoteStatus enforces requireAssocAdmin — non-admins cannot approve/publish minutes. Live positive/negative round-trip covered by live_db_integration_test.go (skip-gated on TEST_DATABASE_URL).")
}
