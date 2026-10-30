package crypto

// RED-PHASE (TDD) unit tests for crypto wallet-to-wallet transfer
// (contracts/openapi.yaml POST /transfers/paymax/crypto, schema
// CryptoWalletTransfer). No live DB: the service is driven through the proposed
// seams in transfer_wallet_stub.go (PIN verifier, AML screen, recipient
// resolver, atomic TransferStore, tier gate, feature flags) using in-memory
// fakes. They FAIL today with errNotImplemented; the implementation PR must make
// them green WITHOUT weakening them.
//
// Every test that expects "nothing moved" ALSO asserts the specific expected
// error, so a not-implemented stub can never make it pass vacuously.
// Test prefix: TestCryptoTransfer_  (live-DB twins: TestLiveDB_CryptoTransfer_).

import (
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"spotlight/backend/internal/finance/tiers"
)

const (
	xferSender    = "user-sender"
	xferRecipient = "user-recipient"
	xferScale     = int64(1_000_000) // USDT-style: 1e6 minor units per whole unit
	// mock-style price: 160_000 kobo (N1,600) per whole USDT.
	xferPriceKobo = int64(160_000)
	xferPIN       = "4821"
)

// ---------------------------------------------------------------- fakes -----

type xferPrice struct{}

func (xferPrice) PriceKobo(_ context.Context, sym string) (int64, bool) {
	if sym == "USDT" {
		return xferPriceKobo, true
	}
	return 0, false
}
func (xferPrice) Name() string { return "fake" }

type xferTier struct {
	mu     sync.Mutex
	err    error
	calls  int
	amount int64
	user   string
}

func (f *xferTier) EnforceWalletDebitLimit(_ context.Context, userID string, amountKobo int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.amount, f.user = amountKobo, userID
	return f.err
}

type xferPINFake struct {
	calls   atomic.Int64
	lockout atomic.Int64 // failed-attempt counter the real verifier would bump
	want    string
}

func (f *xferPINFake) VerifyPin(_ context.Context, _ string, pin string) error {
	f.calls.Add(1)
	if pin != f.want {
		f.lockout.Add(1)
		return ErrPinInvalid
	}
	return nil
}

type xferAMLFake struct {
	calls atomic.Int64
	err   error
	// store snapshot taken AT screening time: proves ordering vs. any debit.
	store                             *xferStore
	execAtScreen                      atomic.Int64
	gotSender, gotRecipient, gotAsset string
	gotMinor                          int64
	mu                                sync.Mutex
}

func (f *xferAMLFake) ScreenTransfer(_ context.Context, sender, recipient, asset string, minor, _ int64) error {
	f.calls.Add(1)
	f.mu.Lock()
	f.gotSender, f.gotRecipient, f.gotAsset, f.gotMinor = sender, recipient, asset, minor
	f.mu.Unlock()
	if f.store != nil {
		f.execAtScreen.Store(int64(f.store.executeCount()))
	}
	return f.err
}

type xferResolverFake struct {
	m         map[string][2]string // identifier -> {id, display name}
	ambiguous map[string]bool
}

func (f *xferResolverFake) ResolveRecipient(_ context.Context, ident string) (string, string, error) {
	if f.ambiguous[ident] {
		return "", "", ErrAmbiguousRecipient
	}
	v, ok := f.m[ident]
	if !ok {
		return "", "", ErrNotFound
	}
	return v[0], v[1], nil
}

type xferLedgerRow struct {
	TransferID, User, Dir string
	Units                 int64
}

type xferAudit struct{ Actor, Action, EntityID string }

type xferStore struct {
	mu     sync.Mutex
	assets map[string]*Asset
	hold   map[string]int64 // user|SYMBOL -> minor units
	ledger []xferLedgerRow
	audits []xferAudit
	byKey  map[string]xferKeyed
	recs   map[string]*TransferRecord
	seq    int
	execs  int
	// failAfterDebit simulates a crash between the debit and credit steps; the
	// store must roll everything back (atomic).
	failAfterDebit error
}

type xferKeyed struct {
	hash string
	rec  *TransferRecord
}

func newXferStore() *xferStore {
	return &xferStore{
		assets: map[string]*Asset{
			"USDT": {ID: "asset-usdt", Symbol: "USDT", MinorUnitScale: xferScale, IsActive: true},
			"OFF":  {ID: "asset-off", Symbol: "OFF", MinorUnitScale: xferScale, IsActive: false},
		},
		hold:  map[string]int64{},
		byKey: map[string]xferKeyed{},
		recs:  map[string]*TransferRecord{},
	}
}

func (s *xferStore) executeCount() int { s.mu.Lock(); defer s.mu.Unlock(); return s.execs }

func (s *xferStore) LookupAsset(_ context.Context, sym string) (*Asset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.assets[sym]
	if !ok {
		return nil, ErrNotFound
	}
	c := *a
	return &c, nil
}

func (s *xferStore) Execute(_ context.Context, c TransferCommand) (*TransferRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.execs++
	k := c.SenderID + "|" + c.IdempotencyKey
	if e, ok := s.byKey[k]; ok {
		if e.hash != c.RequestHash {
			return nil, false, ErrIdempotencyConflict
		}
		cp := *e.rec
		return &cp, true, nil
	}
	from, to := c.SenderID+"|"+c.AssetSymbol, c.RecipientID+"|"+c.AssetSymbol
	if s.hold[from] < c.MinorUnits {
		return nil, false, ErrInsufficientHoldings
	}
	// stage on copies; commit only if every step succeeds
	sf, st := s.hold[from]-c.MinorUnits, s.hold[to]
	if s.failAfterDebit != nil {
		return nil, false, s.failAfterDebit
	}
	st += c.MinorUnits
	s.seq++
	id := fmt.Sprintf("xfer-%d", s.seq)
	rec := &TransferRecord{
		ID: id, Reference: "crypto:wallet_transfer:" + id, SenderID: c.SenderID, RecipientID: c.RecipientID,
		AssetSymbol: c.AssetSymbol, MinorUnits: c.MinorUnits, NgnValueKobo: c.NgnValueKobo,
		Status: "successful", CreatedAt: time.Now().UTC(),
	}
	if c.Narration != "" {
		n := c.Narration
		rec.Narration = &n
	}
	s.hold[from], s.hold[to] = sf, st
	s.ledger = append(s.ledger,
		xferLedgerRow{id, c.SenderID, "DEBIT", c.MinorUnits},
		xferLedgerRow{id, c.RecipientID, "CREDIT", c.MinorUnits})
	s.audits = append(s.audits, xferAudit{c.SenderID, "crypto.wallet_transfer", id})
	s.byKey[k] = xferKeyed{c.RequestHash, rec}
	s.recs[id] = rec
	cp := *rec
	return &cp, false, nil
}

func (s *xferStore) Reverse(_ context.Context, id, actor, _ string, key string) (*TransferRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.recs[id]
	if !ok {
		return nil, ErrNotFound
	}
	if rec.Status == "reversed" {
		cp := *rec
		return &cp, nil
	}
	from, to := rec.RecipientID+"|"+rec.AssetSymbol, rec.SenderID+"|"+rec.AssetSymbol
	if s.hold[from] < rec.MinorUnits {
		return nil, ErrInsufficientHoldings
	}
	s.hold[from] -= rec.MinorUnits
	s.hold[to] += rec.MinorUnits
	s.ledger = append(s.ledger,
		xferLedgerRow{id, rec.RecipientID, "DEBIT", rec.MinorUnits},
		xferLedgerRow{id, rec.SenderID, "CREDIT", rec.MinorUnits})
	s.audits = append(s.audits, xferAudit{actor, "crypto.wallet_transfer.reverse", id})
	rec.Status = "reversed"
	cp := *rec
	return &cp, nil
}

func (s *xferStore) balance(user string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hold[user+"|USDT"]
}
func (s *xferStore) ledgerCopy() []xferLedgerRow {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]xferLedgerRow(nil), s.ledger...)
}
func (s *xferStore) auditCopy() []xferAudit {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]xferAudit(nil), s.audits...)
}

type xferRig struct {
	svc   *Service
	store *xferStore
	pin   *xferPINFake
	aml   *xferAMLFake
	res   *xferResolverFake
	tier  *xferTier
}

func newXferRig(t *testing.T) *xferRig {
	t.Helper()
	store := newXferStore()
	store.hold[xferSender+"|USDT"] = 100 * xferScale // 100 USDT
	r := &xferRig{
		store: store,
		pin:   &xferPINFake{want: xferPIN},
		aml:   &xferAMLFake{store: store},
		res: &xferResolverFake{
			m: map[string][2]string{
				"recipient@example.com": {xferRecipient, "Rita Recipient"},
				"sender@example.com":    {xferSender, "Sam Sender"},
			},
			ambiguous: map[string]bool{"+2348000000000": true},
		},
		tier: &xferTier{},
	}
	r.svc = (&Service{price: xferPrice{}, tiers: r.tier}).WithTransferDeps(TransferDeps{
		PIN: r.pin, AML: r.aml, Resolver: r.res, Store: store,
		Flags: TransferFlags{CryptoEnabled: true, WalletTransfersEnabled: true},
	})
	return r
}

func (r *xferRig) in(units, key string) TransferInput {
	return TransferInput{
		SenderID: xferSender, RecipientIdentifier: "recipient@example.com",
		Asset: "USDT", Units: units, PIN: xferPIN, IdempotencyKey: key,
	}
}

func (r *xferRig) nothingMoved(t *testing.T) {
	t.Helper()
	if got := r.store.balance(xferSender); got != 100*xferScale {
		t.Errorf("sender holding changed: %d", got)
	}
	if got := r.store.balance(xferRecipient); got != 0 {
		t.Errorf("recipient holding changed: %d", got)
	}
	if n := len(r.store.ledgerCopy()); n != 0 {
		t.Errorf("ledger rows written on a refused transfer: %d", n)
	}
	if n := len(r.store.auditCopy()); n != 0 {
		t.Errorf("audit emitted for a refused transfer: %d", n)
	}
}

// --------------------------------------------------- pure: units parsing ----

func TestCryptoTransfer_ParseUnits_ExactIntegerConversion(t *testing.T) {
	cases := []struct {
		in    string
		scale int64
		want  int64
	}{
		{"12.5", 1_000_000, 12_500_000},
		{"1", 1_000_000, 1_000_000},
		{"0.000001", 1_000_000, 1},
		{"0.1", 100_000_000, 10_000_000},
		{"21000000", 100_000_000, 2_100_000_000_000_000},
		{"007.50", 1_000_000, 7_500_000}, // leading zeros are digits, value exact
		{"3", 1, 3},
		// 0.1+0.2 style traps: must be exact, never via float
		{"0.3", 1_000_000_000_000_000_000, 300_000_000_000_000_000},
	}
	for _, c := range cases {
		got, err := ParseUnitsToMinor(c.in, c.scale)
		if err != nil || got != c.want {
			t.Errorf("ParseUnitsToMinor(%q,%d) = %d, %v; want %d, nil", c.in, c.scale, got, err, c.want)
		}
	}
}

func TestCryptoTransfer_ParseUnits_RejectsMalformedAndOutOfRange(t *testing.T) {
	notPositive := []string{"0", "0.0", "0.000000", "000"}
	precision := []struct {
		in    string
		scale int64
	}{{"0.0000001", 1_000_000}, {"1.5", 1}, {"12.1234567", 1_000_000}}
	invalid := []string{
		"", " ", "1e3", "1E3", "1e-6", "-1", "-0", "+1", "1.", ".5", "1.2.3", "1,5", "1_000",
		" 1", "1 ", "1\n", "\t1", "abc", "1abc", "abc1", "0x10", "NaN", "Inf", "-Inf",
		"١٢", // arabic-indic digits are not [0-9]
		"1 2",
		"9223372036854775808",  // > int64 at scale 1
		"10000000000000",       // 1e13 * 1e6 = 1e19 > int64
		"9223372036854.775808", // exactly int64+1 at 1e6
	}
	for _, in := range notPositive {
		if _, err := ParseUnitsToMinor(in, 1_000_000); !errors.Is(err, ErrUnitsNotPositive) {
			t.Errorf("%q: want ErrUnitsNotPositive, got %v", in, err)
		}
	}
	for _, c := range precision {
		if _, err := ParseUnitsToMinor(c.in, c.scale); !errors.Is(err, ErrUnitsPrecision) {
			t.Errorf("%q @scale %d: want ErrUnitsPrecision, got %v", c.in, c.scale, err)
		}
	}
	for _, in := range invalid {
		_, err := ParseUnitsToMinor(in, 1_000_000)
		if !errors.Is(err, ErrInvalidUnits) && !errors.Is(err, ErrUnitsNotPositive) {
			t.Errorf("%q: want ErrInvalidUnits (or NotPositive for -0), got %v", in, err)
		}
	}
	// scale must be sane: fail closed rather than divide by zero.
	for _, sc := range []int64{0, -1} {
		if _, err := ParseUnitsToMinor("1", sc); err == nil || errors.Is(err, errNotImplemented) {
			t.Errorf("scale %d must be refused with a real error, got %v", sc, err)
		}
	}
}

func TestCryptoTransfer_FormatMinorUnits_RoundTrips(t *testing.T) {
	cases := []struct {
		minor, scale int64
		want         string
	}{
		{12_500_000, 1_000_000, "12.5"}, {1, 1_000_000, "0.000001"}, {0, 1_000_000, "0"},
		{5_000_000, 1_000_000, "5"}, {123, 1, "123"}, {10_000_000, 100_000_000, "0.1"},
	}
	for _, c := range cases {
		if got := FormatMinorUnits(c.minor, c.scale); got != c.want {
			t.Errorf("FormatMinorUnits(%d,%d) = %q, want %q", c.minor, c.scale, got, c.want)
		}
		if c.minor > 0 {
			back, err := ParseUnitsToMinor(c.want, c.scale)
			if err != nil || back != c.minor {
				t.Errorf("round-trip %q: %d, %v", c.want, back, err)
			}
		}
	}
}

// implFiles returns the real implementation files (not the stub, not tests).
func implFiles(t *testing.T) []string {
	t.Helper()
	all, err := filepath.Glob("transfer_wallet*.go")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, f := range all {
		if strings.HasSuffix(f, "_test.go") || strings.HasSuffix(f, "_stub.go") {
			continue
		}
		out = append(out, f)
	}
	return out
}

// Iron rule: no float anywhere in the converted amount. Scans the real
// implementation's AST (fails until transfer_wallet*.go exists).
func TestCryptoTransfer_NoFloatInConvertedAmount(t *testing.T) {
	files := implFiles(t)
	if len(files) == 0 {
		t.Fatal("no implementation file transfer_wallet*.go exists yet (TDD red: only the stub is present)")
	}
	banned := map[string]bool{"float32": true, "float64": true, "ParseFloat": true, "Float": true, "NewFloat": true, "Float64": true}
	fset := token.NewFileSet()
	for _, f := range files {
		file, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", f, err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.Ident:
				if banned[x.Name] {
					t.Errorf("%s: float identifier %q in money path", fset.Position(x.Pos()), x.Name)
				}
			case *ast.BasicLit:
				if x.Kind == token.FLOAT {
					t.Errorf("%s: float literal %s in money path", fset.Position(x.Pos()), x.Value)
				}
			}
			return true
		})
	}
}

// Ledger rows are immutable: the implementation must never UPDATE/DELETE them.
func TestCryptoTransfer_ImplementationNeverUpdatesLedgerRows(t *testing.T) {
	files := implFiles(t)
	if len(files) == 0 {
		t.Fatal("no implementation file transfer_wallet*.go exists yet (TDD red)")
	}
	re := regexp.MustCompile(`(?is)(\bUPDATE\s+(public\.)?(crypto_ledger_entries|ledger_entries)\b|\bDELETE\s+FROM\s+(public\.)?(crypto_ledger_entries|ledger_entries)\b)`)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if re.Match(b) {
			t.Errorf("%s mutates ledger rows; corrections must be reversing entries only", f)
		}
	}
}

// ---------------------------------------------------------- service flow ----

func TestCryptoTransfer_Conservation(t *testing.T) {
	r := newXferRig(t)
	before := r.store.balance(xferSender) + r.store.balance(xferRecipient)
	res, err := r.svc.TransferHoldings(context.Background(), r.in("12.5", "k-cons"))
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	if got := r.store.balance(xferSender) + r.store.balance(xferRecipient); got != before {
		t.Errorf("sender+recipient total changed %d -> %d (value created/destroyed)", before, got)
	}
	if r.store.balance(xferSender) != 87_500_000 || r.store.balance(xferRecipient) != 12_500_000 {
		t.Errorf("wrong split: sender=%d recipient=%d", r.store.balance(xferSender), r.store.balance(xferRecipient))
	}
	var sum int64
	var debits, credits int
	for _, row := range r.store.ledgerCopy() {
		switch row.Dir {
		case "DEBIT":
			sum -= row.Units
			debits++
		case "CREDIT":
			sum += row.Units
			credits++
		}
	}
	if sum != 0 || debits != 1 || credits != 1 {
		t.Errorf("ledger must be one balanced DEBIT/CREDIT pair: sum=%d debits=%d credits=%d", sum, debits, credits)
	}
	if res.Units != "12.5" || res.FeeUnits != "0" || res.Asset != "USDT" || res.Status != "successful" || res.AlreadyProcessed {
		t.Errorf("unexpected result shape: %+v", res)
	}
	// 12.5 USDT * 160_000 kobo = 2_000_000 kobo mark, integer math.
	if res.NgnValueKobo != 2_000_000 {
		t.Errorf("ngn_value_kobo = %d, want 2000000", res.NgnValueKobo)
	}
	if res.ReceiverDisplayName == nil || *res.ReceiverDisplayName != "Rita Recipient" {
		t.Errorf("receiver_display_name = %v", res.ReceiverDisplayName)
	}
}

func TestCryptoTransfer_Atomicity_MidwayFailureLeavesNothingBehind(t *testing.T) {
	r := newXferRig(t)
	boom := errors.New("simulated crash between debit and credit")
	r.store.failAfterDebit = boom
	_, err := r.svc.TransferHoldings(context.Background(), r.in("10", "k-atomic"))
	if !errors.Is(err, boom) {
		t.Fatalf("want the mid-way failure propagated, got %v", err)
	}
	r.nothingMoved(t)
	// the failed attempt must not poison the key: a retry after recovery succeeds.
	r.store.failAfterDebit = nil
	if _, err := r.svc.TransferHoldings(context.Background(), r.in("10", "k-atomic")); err != nil {
		t.Fatalf("retry with same key after rollback must succeed: %v", err)
	}
	if r.store.balance(xferRecipient) != 10*xferScale {
		t.Errorf("recipient should hold exactly one transfer, got %d", r.store.balance(xferRecipient))
	}
}

func TestCryptoTransfer_IdempotentReplay_SameTransferNoSecondMovement(t *testing.T) {
	r := newXferRig(t)
	first, err := r.svc.TransferHoldings(context.Background(), r.in("5", "k-replay"))
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := r.svc.TransferHoldings(context.Background(), r.in("5", "k-replay"))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if first.AlreadyProcessed || !second.AlreadyProcessed {
		t.Errorf("already_processed: first=%v second=%v, want false/true", first.AlreadyProcessed, second.AlreadyProcessed)
	}
	if first.ID != second.ID || first.Reference != second.Reference {
		t.Errorf("replay must return the SAME transfer: %s/%s vs %s/%s", first.ID, first.Reference, second.ID, second.Reference)
	}
	if r.store.balance(xferRecipient) != 5*xferScale || r.store.balance(xferSender) != 95*xferScale {
		t.Errorf("replay moved money again: sender=%d recipient=%d", r.store.balance(xferSender), r.store.balance(xferRecipient))
	}
	if n := len(r.store.ledgerCopy()); n != 2 {
		t.Errorf("ledger rows = %d, want exactly 2", n)
	}
	if n := len(r.store.auditCopy()); n != 1 {
		t.Errorf("audit events = %d, want exactly 1 (replay must not re-audit)", n)
	}
}

func TestCryptoTransfer_KeyReuseWithDifferentBody_IsConflict(t *testing.T) {
	r := newXferRig(t)
	if _, err := r.svc.TransferHoldings(context.Background(), r.in("5", "k-conflict")); err != nil {
		t.Fatalf("first: %v", err)
	}
	for name, mutate := range map[string]func(*TransferInput){
		"units":     func(i *TransferInput) { i.Units = "6" },
		"recipient": func(i *TransferInput) { i.RecipientIdentifier = "sender@example.com" },
		"narration": func(i *TransferInput) { i.Narration = "different" },
	} {
		in := r.in("5", "k-conflict")
		mutate(&in)
		_, err := r.svc.TransferHoldings(context.Background(), in)
		// self-transfer for "recipient" mutation may legitimately fire first; both are refusals.
		if !errors.Is(err, ErrIdempotencyConflict) && !(name == "recipient" && errors.Is(err, ErrSelfTransfer)) {
			t.Errorf("%s: want ErrIdempotencyConflict, got %v", name, err)
		}
	}
	if r.store.balance(xferRecipient) != 5*xferScale {
		t.Errorf("conflicting reuse moved money: recipient=%d", r.store.balance(xferRecipient))
	}
	if st, code := TransferErrorStatus(ErrIdempotencyConflict); st != http.StatusConflict || code == "" {
		t.Errorf("conflict maps to %d/%q, want 409 + code", st, code)
	}
}

func TestCryptoTransfer_IdempotencyKeyIsScopedToCaller(t *testing.T) {
	r := newXferRig(t)
	r.store.hold["user-other|USDT"] = 50 * xferScale
	if _, err := r.svc.TransferHoldings(context.Background(), r.in("5", "shared-key")); err != nil {
		t.Fatalf("sender A: %v", err)
	}
	other := r.in("5", "shared-key")
	other.SenderID = "user-other"
	res, err := r.svc.TransferHoldings(context.Background(), other)
	if err != nil {
		t.Fatalf("sender B reusing A's key must be an independent transfer, got %v", err)
	}
	if res.AlreadyProcessed {
		t.Error("another caller's key must never replay someone else's transfer")
	}
	if r.store.balance("user-other") != 45*xferScale || r.store.balance(xferRecipient) != 10*xferScale {
		t.Errorf("balances: other=%d recipient=%d", r.store.balance("user-other"), r.store.balance(xferRecipient))
	}
}

func TestCryptoTransfer_MissingIdempotencyKey_Refused(t *testing.T) {
	r := newXferRig(t)
	for _, k := range []string{"", "   "} {
		_, err := r.svc.TransferHoldings(context.Background(), r.in("1", k))
		if !errors.Is(err, ErrIdempotencyKeyRequired) {
			t.Errorf("key %q: want ErrIdempotencyKeyRequired, got %v", k, err)
		}
	}
	r.nothingMoved(t)
	if st, _ := TransferErrorStatus(ErrIdempotencyKeyRequired); st != http.StatusBadRequest {
		t.Errorf("missing key status = %d, want 400", st)
	}
}

func TestCryptoTransfer_ConcurrentIdenticalRequests_MoveMoneyOnce(t *testing.T) {
	r := newXferRig(t)
	const n = 32
	var wg sync.WaitGroup
	results := make([]*TransferResult, n)
	errs := make([]error, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i], errs[i] = r.svc.TransferHoldings(context.Background(), r.in("7", "k-race"))
		}(i)
	}
	close(start)
	wg.Wait()
	fresh, replays := 0, 0
	var id string
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("request %d failed: %v", i, errs[i])
		}
		if id == "" {
			id = results[i].ID
		}
		if results[i].ID != id {
			t.Errorf("request %d produced a different transfer %s != %s", i, results[i].ID, id)
		}
		if results[i].AlreadyProcessed {
			replays++
		} else {
			fresh++
		}
	}
	if fresh != 1 || replays != n-1 {
		t.Errorf("fresh=%d replays=%d, want 1/%d", fresh, replays, n-1)
	}
	if r.store.balance(xferRecipient) != 7*xferScale || len(r.store.ledgerCopy()) != 2 {
		t.Errorf("money moved more than once: recipient=%d ledger=%d", r.store.balance(xferRecipient), len(r.store.ledgerCopy()))
	}
}

func TestCryptoTransfer_InsufficientHoldings_MovesNothing(t *testing.T) {
	r := newXferRig(t)
	_, err := r.svc.TransferHoldings(context.Background(), r.in("100.000001", "k-insuf"))
	if !errors.Is(err, ErrInsufficientHoldings) {
		t.Fatalf("want ErrInsufficientHoldings, got %v", err)
	}
	r.nothingMoved(t)
	if st, code := TransferErrorStatus(err); st != http.StatusPaymentRequired || code != "insufficient_holdings" {
		t.Errorf("maps to %d/%q, want 402/insufficient_holdings", st, code)
	}
}

func TestCryptoTransfer_ExactBalanceTransfer_SucceedsLeavingZero(t *testing.T) {
	r := newXferRig(t)
	if _, err := r.svc.TransferHoldings(context.Background(), r.in("100", "k-exact")); err != nil {
		t.Fatalf("exact-balance transfer must succeed: %v", err)
	}
	if r.store.balance(xferSender) != 0 || r.store.balance(xferRecipient) != 100*xferScale {
		t.Errorf("sender=%d recipient=%d, want 0 / 100e6", r.store.balance(xferSender), r.store.balance(xferRecipient))
	}
}

func TestCryptoTransfer_UnitsValidation_RefusedBeforeAnyWork(t *testing.T) {
	r := newXferRig(t)
	for _, u := range []string{"", "0", "-5", "1e3", "0.0000001", "1.", " 5", "5 ", "abc"} {
		_, err := r.svc.TransferHoldings(context.Background(), r.in(u, "k-units-"+u))
		if !(errors.Is(err, ErrInvalidUnits) || errors.Is(err, ErrUnitsNotPositive) || errors.Is(err, ErrUnitsPrecision)) {
			t.Errorf("units %q: want a 422 units refusal, got %v", u, err)
			continue
		}
		if st, _ := TransferErrorStatus(err); st != http.StatusUnprocessableEntity {
			t.Errorf("units %q maps to %d, want 422", u, st)
		}
	}
	r.nothingMoved(t)
	if r.aml.calls.Load() != 0 {
		t.Error("invalid units must be refused before AML screening")
	}
}

func TestCryptoTransfer_SelfTransfer_Refused(t *testing.T) {
	r := newXferRig(t)
	in := r.in("1", "k-self")
	in.RecipientIdentifier = "sender@example.com" // resolves to the caller
	_, err := r.svc.TransferHoldings(context.Background(), in)
	if !errors.Is(err, ErrSelfTransfer) {
		t.Fatalf("want ErrSelfTransfer, got %v", err)
	}
	if st, code := TransferErrorStatus(err); st != http.StatusUnprocessableEntity || code != "self_transfer" {
		t.Errorf("maps to %d/%q, want 422/self_transfer", st, code)
	}
	r.nothingMoved(t)
	if r.aml.calls.Load() != 0 || r.store.executeCount() != 0 {
		t.Error("self transfer must be refused before AML and before the store")
	}
}

func TestCryptoTransfer_Pin_MissingIsNeverVerifiedAndNotCounted(t *testing.T) {
	r := newXferRig(t)
	in := r.in("1", "k-nopin")
	in.PIN = ""
	_, err := r.svc.TransferHoldings(context.Background(), in)
	if !errors.Is(err, ErrPinRequired) {
		t.Fatalf("want ErrPinRequired, got %v", err)
	}
	if r.pin.calls.Load() != 0 || r.pin.lockout.Load() != 0 {
		t.Errorf("missing PIN must NOT be verified or counted: verifyCalls=%d lockout=%d", r.pin.calls.Load(), r.pin.lockout.Load())
	}
	if st, _ := TransferErrorStatus(err); st != http.StatusBadRequest {
		t.Errorf("missing PIN maps to %d, want 400", st)
	}
	r.nothingMoved(t)
}

func TestCryptoTransfer_Pin_WrongIs403AndCounts(t *testing.T) {
	r := newXferRig(t)
	in := r.in("1", "k-badpin")
	in.PIN = "0000"
	_, err := r.svc.TransferHoldings(context.Background(), in)
	if !errors.Is(err, ErrPinInvalid) {
		t.Fatalf("want ErrPinInvalid, got %v", err)
	}
	if r.pin.calls.Load() != 1 || r.pin.lockout.Load() != 1 {
		t.Errorf("wrong PIN must be verified exactly once and counted: calls=%d lockout=%d", r.pin.calls.Load(), r.pin.lockout.Load())
	}
	if st, _ := TransferErrorStatus(err); st != http.StatusForbidden {
		t.Errorf("wrong PIN maps to %d, want 403", st)
	}
	r.nothingMoved(t)
	if r.aml.calls.Load() != 0 {
		t.Error("PIN failure must precede AML screening")
	}
}

func TestCryptoTransfer_AMLRefusal_HappensBeforeAnyDebit(t *testing.T) {
	r := newXferRig(t)
	r.aml.err = ErrAMLRefused
	_, err := r.svc.TransferHoldings(context.Background(), r.in("10", "k-aml"))
	if !errors.Is(err, ErrAMLRefused) {
		t.Fatalf("want ErrAMLRefused, got %v", err)
	}
	if st, _ := TransferErrorStatus(err); st != http.StatusForbidden {
		t.Errorf("AML refusal maps to %d, want 403", st)
	}
	if r.aml.calls.Load() != 1 {
		t.Fatalf("AML screen calls = %d, want 1", r.aml.calls.Load())
	}
	if r.store.executeCount() != 0 {
		t.Errorf("store.Execute ran %d time(s) after an AML refusal; no debit may be attempted", r.store.executeCount())
	}
	r.nothingMoved(t)
	if r.tier.calls != 0 {
		// tier gate is a debit-side check; AML refusal should not need it, but either order is
		// acceptable ONLY if nothing moved. Not asserted beyond nothingMoved.
		t.Log("note: tier gate consulted before AML")
	}
}

func TestCryptoTransfer_AML_ScreensSenderRecipientAndAmount_BeforeExecute(t *testing.T) {
	r := newXferRig(t)
	if _, err := r.svc.TransferHoldings(context.Background(), r.in("12.5", "k-aml-ok")); err != nil {
		t.Fatalf("transfer: %v", err)
	}
	if r.aml.execAtScreen.Load() != 0 {
		t.Errorf("AML ran after %d store executions; it must run BEFORE any debit", r.aml.execAtScreen.Load())
	}
	r.aml.mu.Lock()
	defer r.aml.mu.Unlock()
	if r.aml.gotSender != xferSender || r.aml.gotRecipient != xferRecipient || r.aml.gotAsset != "USDT" || r.aml.gotMinor != 12_500_000 {
		t.Errorf("AML saw sender=%q recipient=%q asset=%q minor=%d", r.aml.gotSender, r.aml.gotRecipient, r.aml.gotAsset, r.aml.gotMinor)
	}
}

func TestCryptoTransfer_AMLInfrastructureError_FailsClosed(t *testing.T) {
	r := newXferRig(t)
	r.aml.err = errors.New("aml provider timeout")
	_, err := r.svc.TransferHoldings(context.Background(), r.in("1", "k-aml-down"))
	if err == nil || errors.Is(err, errNotImplemented) {
		t.Fatalf("an AML outage must refuse with a real error, got %v", err)
	}
	r.nothingMoved(t)
}

func TestCryptoTransfer_AMLMissing_FailsClosed(t *testing.T) {
	r := newXferRig(t)
	r.svc.WithTransferDeps(TransferDeps{
		PIN: r.pin, Resolver: r.res, Store: r.store, // AML nil
		Flags: TransferFlags{CryptoEnabled: true, WalletTransfersEnabled: true},
	})
	_, err := r.svc.TransferHoldings(context.Background(), r.in("1", "k-aml-nil"))
	if err == nil || errors.Is(err, errNotImplemented) {
		t.Fatalf("unwired AML screen must fail closed with a real error, got %v", err)
	}
	r.nothingMoved(t)
}

func TestCryptoTransfer_TierLimit_BreachFailsClosed(t *testing.T) {
	for _, sentinel := range []error{tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded} {
		r := newXferRig(t)
		r.tier.err = sentinel
		_, err := r.svc.TransferHoldings(context.Background(), r.in("12.5", "k-tier"))
		if !errors.Is(err, sentinel) {
			t.Fatalf("want %v propagated unwrapped-by-Is, got %v", sentinel, err)
		}
		if st, _ := TransferErrorStatus(err); st != http.StatusForbidden {
			t.Errorf("%v maps to %d, want 403", sentinel, st)
		}
		r.nothingMoved(t)
		// gate must be evaluated against the NGN mark in kobo, as the SENDER.
		if r.tier.calls != 1 || r.tier.amount != 2_000_000 || r.tier.user != xferSender {
			t.Errorf("tier gate saw user=%q amount=%d calls=%d; want sender / 2000000 kobo / 1", r.tier.user, r.tier.amount, r.tier.calls)
		}
	}
}

func TestCryptoTransfer_TierLookupError_FailsClosed(t *testing.T) {
	r := newXferRig(t)
	r.tier.err = errors.New("tiers: get tier (fail closed): connection refused")
	_, err := r.svc.TransferHoldings(context.Background(), r.in("1", "k-tier-err"))
	if err == nil || errors.Is(err, errNotImplemented) {
		t.Fatalf("a failing tier lookup must deny with a real error, got %v", err)
	}
	r.nothingMoved(t)
}

func TestCryptoTransfer_TierGateUnwired_FailsClosed(t *testing.T) {
	r := newXferRig(t)
	r.svc.tiers = nil
	_, err := r.svc.TransferHoldings(context.Background(), r.in("1", "k-tier-nil"))
	if !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("want ErrTierGateUnwired, got %v", err)
	}
	r.nothingMoved(t)
}

func TestCryptoTransfer_FeatureFlags_BothMustBeOn(t *testing.T) {
	cases := []TransferFlags{
		{false, false}, {true, false}, {false, true}, // {} zero value == default off
	}
	for _, f := range cases {
		r := newXferRig(t)
		r.svc.WithTransferDeps(TransferDeps{PIN: r.pin, AML: r.aml, Resolver: r.res, Store: r.store, Flags: f})
		_, err := r.svc.TransferHoldings(context.Background(), r.in("1", "k-flag"))
		if !errors.Is(err, ErrTransfersDisabled) {
			t.Errorf("flags %+v: want ErrTransfersDisabled, got %v", f, err)
		}
		if st, _ := TransferErrorStatus(ErrTransfersDisabled); st != http.StatusServiceUnavailable {
			t.Errorf("disabled maps to %d, want 503", st)
		}
		if r.pin.calls.Load() != 0 || r.aml.calls.Load() != 0 || r.store.executeCount() != 0 || r.tier.calls != 0 {
			t.Errorf("flags %+v: a disabled feature must do no work (pin=%d aml=%d exec=%d tier=%d)",
				f, r.pin.calls.Load(), r.aml.calls.Load(), r.store.executeCount(), r.tier.calls)
		}
		r.nothingMoved(t)
	}
	// both on => works
	r := newXferRig(t)
	if _, err := r.svc.TransferHoldings(context.Background(), r.in("1", "k-flag-on")); err != nil {
		t.Errorf("both flags on must allow the transfer: %v", err)
	}
}

func TestCryptoTransfer_FeatureFlags_DefaultServiceIsOff(t *testing.T) {
	s := &Service{price: xferPrice{}, tiers: &xferTier{}} // no deps installed at all
	_, err := s.TransferHoldings(context.Background(), TransferInput{
		SenderID: xferSender, RecipientIdentifier: "recipient@example.com",
		Asset: "USDT", Units: "1", PIN: xferPIN, IdempotencyKey: "k-default",
	})
	if !errors.Is(err, ErrTransfersDisabled) {
		t.Fatalf("a service with no transfer deps must be disabled (fail closed), got %v", err)
	}
}

func TestCryptoTransfer_AssetAndRecipientLookups_Are404OrConflict(t *testing.T) {
	r := newXferRig(t)
	cases := []struct {
		name   string
		mutate func(*TransferInput)
		want   error
		status int
		code   string
	}{
		{"unknown asset", func(i *TransferInput) { i.Asset = "NOPE" }, ErrNotFound, 404, ""},
		{"disabled asset", func(i *TransferInput) { i.Asset = "OFF" }, ErrAssetInactive, 404, ""},
		{"unknown recipient", func(i *TransferInput) { i.RecipientIdentifier = "ghost@example.com" }, ErrNotFound, 404, ""},
		{"ambiguous phone", func(i *TransferInput) { i.RecipientIdentifier = "+2348000000000" }, ErrAmbiguousRecipient, 409, "ambiguous_recipient"},
	}
	for i, c := range cases {
		in := r.in("1", fmt.Sprintf("k-lookup-%d", i))
		c.mutate(&in)
		_, err := r.svc.TransferHoldings(context.Background(), in)
		if !errors.Is(err, c.want) {
			t.Errorf("%s: want %v, got %v", c.name, c.want, err)
			continue
		}
		st, code := TransferErrorStatus(err)
		if st != c.status || (c.code != "" && code != c.code) {
			t.Errorf("%s: maps to %d/%q, want %d/%q", c.name, st, code, c.status, c.code)
		}
	}
	r.nothingMoved(t)
	if r.store.executeCount() != 0 {
		t.Error("lookup refusals (incl. ambiguous recipient) must happen before any debit attempt")
	}
}

func TestCryptoTransfer_AuditEventEmitted(t *testing.T) {
	r := newXferRig(t)
	res, err := r.svc.TransferHoldings(context.Background(), r.in("2", "k-audit"))
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	a := r.store.auditCopy()
	if len(a) != 1 || a[0].Action != "crypto.wallet_transfer" || a[0].Actor != xferSender || a[0].EntityID != res.ID {
		t.Errorf("audit trail = %+v, want one crypto.wallet_transfer by sender for %s", a, res.ID)
	}
}

func TestCryptoTransfer_LedgerRowsNeverUpdated_ReversalIsNewPair(t *testing.T) {
	r := newXferRig(t)
	res, err := r.svc.TransferHoldings(context.Background(), r.in("30", "k-rev"))
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	original := r.store.ledgerCopy()
	rev, err := r.svc.ReverseTransfer(context.Background(), res.ID, "admin-1", "customer dispute", "k-rev-1")
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}
	if rev.Status != "reversed" {
		t.Errorf("status = %q, want reversed", rev.Status)
	}
	after := r.store.ledgerCopy()
	if len(after) != len(original)+2 {
		t.Fatalf("a reversal must APPEND exactly one new pair: %d -> %d rows", len(original), len(after))
	}
	for i := range original {
		if after[i] != original[i] {
			t.Errorf("original ledger row %d was modified: %+v -> %+v", i, original[i], after[i])
		}
	}
	var sum int64
	for _, row := range after {
		if row.Dir == "DEBIT" {
			sum -= row.Units
		} else {
			sum += row.Units
		}
	}
	if sum != 0 {
		t.Errorf("ledger no longer balances after reversal: %d", sum)
	}
	if r.store.balance(xferSender) != 100*xferScale || r.store.balance(xferRecipient) != 0 {
		t.Errorf("reversal must restore holdings: sender=%d recipient=%d", r.store.balance(xferSender), r.store.balance(xferRecipient))
	}
}

func TestCryptoTransfer_ErrorStatusMapping(t *testing.T) {
	cases := []struct {
		err    error
		status int
	}{
		{ErrPinRequired, 400}, {ErrIdempotencyKeyRequired, 400},
		{ErrPinInvalid, 403}, {ErrAMLRefused, 403}, {tiers.ErrDailyLimitExceeded, 403}, {tiers.ErrWalletDisabled, 403},
		{ErrInsufficientHoldings, 402},
		{ErrNotFound, 404}, {ErrAssetInactive, 404},
		{ErrAmbiguousRecipient, 409}, {ErrIdempotencyConflict, 409},
		{ErrSelfTransfer, 422}, {ErrInvalidUnits, 422}, {ErrUnitsNotPositive, 422}, {ErrUnitsPrecision, 422},
		{ErrTransfersDisabled, 503}, {ErrTierGateUnwired, 503},
		{fmt.Errorf("wrapped: %w", ErrInsufficientHoldings), 402},
		{errors.New("boom"), 500},
	}
	for _, c := range cases {
		if got, _ := TransferErrorStatus(c.err); got != c.status {
			t.Errorf("TransferErrorStatus(%v) = %d, want %d", c.err, got, c.status)
		}
	}
}
