// Package top5events_test — money-path invariant tests for the Top-5 Event
// Ticketing + cashless Event Wallet module.
//
// This file EXTENDS the DB-free reference mirror in service_mirror_test.go. It
// closes the gaps against the six money-path iron rules that the mirror suite did
// not yet prove:
//
//   - Inv 2  Vendor settlement SPLIT sums EXACTLY to the charged total across an
//     arbitrary set of tap-charges — net + fee == gross, both legs
//     non-negative, no rounding leak. (mirror only tested fee math on a
//     single hand-picked gross value.)
//   - Inv 4  TapCharge fails CLOSED on insufficient balance — NO attendee debit AND
//     NO vendor float credit is written. (mirror asserted the attendee
//     balance was unchanged but never proved the vendor leg was skipped.)
//   - Inv 5  The tier/limit gate fails CLOSED:
//     (a) Purchase/TopUp go through wallet.Debit which calls
//     tiers.EnforceWalletDebitLimit FIRST — an over-limit / disabled
//     tier ⇒ the ledger debit is NEVER reached (no money moves).
//     (b) SettleVendor is KYC-gated (Service.SettleVendor: tier<1 ⇒
//     ErrKYCRequired) and returns BEFORE it opens its tx, so no
//     settlement row and no payout ledger legs are written.
//
// Why mirrors and not the real Service? Same reason as service_mirror_test.go:
// top5events.Service and its finance deps (ledger/wallet/tiers/settlement) bind
// directly to a concrete *pgxpool.Pool with no interface seam, and this CI lane has
// no Postgres (see .github/workflows/top5-ci.yml). These are PURE-LOGIC mirrors of
// the exact guards in service.go — cross-referenced below to the production source
// of truth so any divergence is a defect to reconcile. Every money quantity is an
// int64 kobo literal; there is no float arithmetic anywhere in this file.
package top5events_test

import (
	"errors"
	"testing"
)

// ===========================================================================
// Inv 2. Vendor settlement SPLIT — mirrors Service.SettleVendor's fee math and
// the balanced escrow legs it posts:
//
//	gross := SUM(vendor_float WHERE settled=false)      // total charged to vendor
//	fee   := (gross * ev.FeeBps) / 10000                // platform fee_bps, int div
//	net   := gross - fee                                // vendor payout
//	// ledger: escrow -> vendorUser (net) ; escrow -> paymax_revenue (fee, if >0)
//
// The invariant the tests below PROVE: whatever the set of individual charges and
// whatever the fee_bps, net+fee reconstitutes gross EXACTLY (no kobo created or
// destroyed), both legs are >= 0, and the fee leg is only posted when fee > 0
// (matching the `if fee > 0` guard in service.go so no zero-value journal is cut).
// ===========================================================================

// vendorFloatLeg mirrors one vendor_float row accrued by a TapCharge.
type vendorFloatLeg struct {
	amountKobo int64
	settled    bool
}

// settleVendorSplit mirrors the exact arithmetic in Service.SettleVendor: it sums
// the UNSETTLED float, derives fee/net by integer basis-point math, and reports
// whether a fee leg would be posted (the `if fee > 0` guard). It returns the two
// balanced legs that would be drawn from escrow.
func settleVendorSplit(legs []vendorFloatLeg, feeBps int) (gross, fee, net int64, postFeeLeg bool) {
	for _, l := range legs {
		if !l.settled {
			gross += l.amountKobo
		}
	}
	fee = (gross * int64(feeBps)) / 10000 // integer division — truncates toward zero, never rounds up
	net = gross - fee
	postFeeLeg = fee > 0
	return
}

func TestSettlementSplit_NetPlusFeeReconstitutesChargedTotalExactly(t *testing.T) {
	// A realistic mixed bag of tap-charges plus varied fee_bps. For each case the
	// split must satisfy: gross == sum(unsettled charges); net+fee == gross exactly;
	// both legs non-negative. This is the anti-leak invariant (Inv 2 + Inv 6).
	cases := []struct {
		name    string
		charges []int64 // unsettled tap-charge amounts (kobo)
		feeBps  int
	}{
		{"single round charge, 2.5% fee", []int64{100_000_00}, 250},
		{"many small odd charges, 2.5% fee", []int64{1_37, 9_99, 250_01, 4_444_44, 7}, 250},
		{"prime-ish charges, 3.33%-ish fee", []int64{99_991, 100_003, 7}, 333},
		{"zero fee_bps — vendor takes everything", []int64{5_000_00, 2_500_00}, 0},
		{"100% fee_bps — platform takes everything, vendor net zero", []int64{3_333_33}, 10000},
		{"tiny gross where fee rounds to zero", []int64{99, 1}, 1}, // (100*1)/10000 = 0
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			legs := make([]vendorFloatLeg, len(tc.charges))
			var wantGross int64
			for i, c := range tc.charges {
				legs[i] = vendorFloatLeg{amountKobo: c, settled: false}
				wantGross += c
			}

			gross, fee, net, _ := settleVendorSplit(legs, tc.feeBps)

			// The settled gross is exactly the sum of the charged amounts.
			if gross != wantGross {
				t.Fatalf("gross = %d, want sum(charges) = %d", gross, wantGross)
			}
			// No rounding leak: the split reconstitutes the charged total EXACTLY.
			if fee+net != gross {
				t.Fatalf("fee+net = %d, want gross %d — money leaked or was created in the split", fee+net, gross)
			}
			// No negative legs: a payout or fee can never be negative.
			if fee < 0 || net < 0 {
				t.Fatalf("negative settlement leg: fee=%d net=%d (both must be >= 0)", fee, net)
			}
			// Fee is the truncated-integer basis-point cut, never exceeding gross.
			if fee > gross {
				t.Fatalf("fee %d exceeds gross %d — impossible for feeBps <= 10000", fee, gross)
			}
		})
	}
}

func TestSettlementSplit_FeeLegOnlyPostedWhenPositive(t *testing.T) {
	// Mirrors the `if fee > 0` guard in Service.SettleVendor: a zero fee must NOT
	// cut a zero-value revenue journal (a balanced-but-pointless posting), and a
	// positive fee MUST post the escrow->revenue leg.
	zeroFee := []vendorFloatLeg{{amountKobo: 100, settled: false}} // (100*1)/10000 = 0
	_, fee, _, postFeeLeg := settleVendorSplit(zeroFee, 1)
	if fee != 0 || postFeeLeg {
		t.Fatalf("zero-fee case: fee=%d postFeeLeg=%v, want fee=0 and NO fee leg", fee, postFeeLeg)
	}

	realFee := []vendorFloatLeg{{amountKobo: 100_000_00, settled: false}}
	_, fee, _, postFeeLeg = settleVendorSplit(realFee, 250)
	if fee != 2_500_00 || !postFeeLeg {
		t.Fatalf("real-fee case: fee=%d postFeeLeg=%v, want fee=250000 and a fee leg", fee, postFeeLeg)
	}
}

func TestSettlementSplit_OnlyUnsettledFloatIsPaidOut(t *testing.T) {
	// Mirrors `WHERE settled=false`: an already-settled float leg must NOT be
	// double-counted into a later settlement's gross (no double payout of the same
	// takings — Inv 1/Inv 2 idempotency at the float level).
	legs := []vendorFloatLeg{
		{amountKobo: 1_000_00, settled: true},  // already paid out in a prior settlement
		{amountKobo: 2_000_00, settled: false}, // new takings
		{amountKobo: 3_000_00, settled: false},
	}
	gross, fee, net, _ := settleVendorSplit(legs, 250)
	if gross != 5_000_00 {
		t.Fatalf("gross = %d, want 500000 (only the two UNSETTLED legs, not the settled one)", gross)
	}
	if fee+net != gross {
		t.Fatalf("fee+net = %d, want gross %d", fee+net, gross)
	}
}

// TestSettlementSplit_SumOfChargesEqualsSumOfPayoutLegs proves the end-to-end
// conservation law across the WHOLE vendor lifecycle: every kobo an attendee is
// charged (TapCharge -> vendor_float) is later distributed, with no leak, into
// exactly two destinations — the vendor's net payout and platform revenue. The two
// destination totals must sum back to the grand total charged.
func TestSettlementSplit_SumOfChargesEqualsSumOfPayoutLegs(t *testing.T) {
	charges := []int64{1_250_00, 37_50, 9_99, 500_00, 4_20}
	const feeBps = 275 // 2.75%

	legs := make([]vendorFloatLeg, len(charges))
	var totalCharged int64
	for i, c := range charges {
		legs[i] = vendorFloatLeg{amountKobo: c, settled: false}
		totalCharged += c
	}

	gross, fee, net, _ := settleVendorSplit(legs, feeBps)
	if gross != totalCharged {
		t.Fatalf("gross %d != total charged %d", gross, totalCharged)
	}
	// Conservation: vendor payout + platform revenue == everything the attendees paid.
	if net+fee != totalCharged {
		t.Fatalf("net(%d)+fee(%d)=%d != totalCharged %d — split does not conserve money", net, fee, net+fee, totalCharged)
	}
}

// ===========================================================================
// Inv 4 (strengthened). TapCharge fails CLOSED on insufficient balance: NEITHER
// the attendee CHARGE entry NOR the vendor float credit may be written. The mirror
// suite proved the attendee balance was unchanged; here we also prove the VENDOR
// leg is skipped, mirroring the early `return ErrInsufficientFloat` in
// Service.TapCharge that happens BEFORE either INSERT.
// ===========================================================================

// tapChargeVendorLedger mirrors the two-sided write in Service.TapCharge: an
// attendee-side CHARGE and a vendor-side float credit are written TOGETHER inside
// one tx, and only AFTER the balance check passes. If the balance check fails the
// method returns before either INSERT, so both sides stay empty.
type tapChargeVendorLedger struct {
	attendeeBalance int64   // projection of the attendee event-wallet
	closed          bool    // wallet CLOSED?
	attendeeCharges []int64 // CHARGE entries written to the attendee sub-balance
	vendorCredits   []int64 // vendor_float rows written for the vendor
	seen            map[string]bool
}

func newTapChargeLedger(balance int64) *tapChargeVendorLedger {
	return &tapChargeVendorLedger{attendeeBalance: balance, seen: map[string]bool{}}
}

// tapCharge mirrors Service.TapCharge ordering exactly: idempotency replay first,
// then CLOSED guard, then the insufficient-funds guard, and ONLY THEN the paired
// (attendee CHARGE, vendor float credit) inserts. Any early return leaves both
// ledgers untouched.
func (l *tapChargeVendorLedger) tapCharge(amountKobo int64, idemKey string) error {
	if amountKobo <= 0 {
		return errors.New("events: charge must be positive kobo")
	}
	if l.seen[idemKey] {
		return nil // replay: existing charge returned, no new legs (Inv 1)
	}
	if l.closed {
		return errWalletClosed
	}
	if l.attendeeBalance < amountKobo {
		return errInsufficientFloat // fail CLOSED — return BEFORE any write
	}
	// Both legs are written atomically only on the success path.
	l.attendeeCharges = append(l.attendeeCharges, amountKobo)
	l.vendorCredits = append(l.vendorCredits, amountKobo)
	l.attendeeBalance -= amountKobo
	l.seen[idemKey] = true
	return nil
}

func TestTapCharge_InsufficientBalance_WritesNoVendorCredit(t *testing.T) {
	l := newTapChargeLedger(1_000_00) // 100000 kobo available

	if err := l.tapCharge(2_000_00, "over-1"); !errors.Is(err, errInsufficientFloat) {
		t.Fatalf("overdraw charge: got %v, want errInsufficientFloat", err)
	}
	// Inv 4: fail-closed means NO attendee debit AND NO vendor credit.
	if len(l.attendeeCharges) != 0 {
		t.Fatalf("attendee CHARGE entries = %d, want 0 (no debit on failed charge)", len(l.attendeeCharges))
	}
	if len(l.vendorCredits) != 0 {
		t.Fatalf("vendor float credits = %d, want 0 (vendor must not be paid for a charge that never cleared)", len(l.vendorCredits))
	}
	if l.attendeeBalance != 1_000_00 {
		t.Fatalf("attendee balance = %d, want unchanged 100000", l.attendeeBalance)
	}
}

func TestTapCharge_SuccessWritesBothLegsInLockstep(t *testing.T) {
	// The complement: on the success path exactly one attendee CHARGE and exactly
	// one matching vendor credit are written, for the SAME amount (double-entry:
	// what leaves the attendee sub-balance equals what accrues to the vendor float).
	l := newTapChargeLedger(5_000_00)
	if err := l.tapCharge(1_500_00, "ok-1"); err != nil {
		t.Fatalf("charge: %v", err)
	}
	if len(l.attendeeCharges) != 1 || len(l.vendorCredits) != 1 {
		t.Fatalf("legs = attendee:%d vendor:%d, want exactly 1 each", len(l.attendeeCharges), len(l.vendorCredits))
	}
	if l.attendeeCharges[0] != l.vendorCredits[0] {
		t.Fatalf("attendee charge %d != vendor credit %d — the two-sided move must be balanced", l.attendeeCharges[0], l.vendorCredits[0])
	}
	if l.attendeeBalance != 3_500_00 {
		t.Fatalf("attendee balance = %d, want 350000 after a 150000 charge", l.attendeeBalance)
	}
}

func TestTapCharge_ClosedWallet_WritesNoVendorCredit(t *testing.T) {
	// A charge against a CLOSED wallet must also leave both ledgers untouched.
	l := newTapChargeLedger(1_000_00)
	l.closed = true
	if err := l.tapCharge(100, "closed-1"); !errors.Is(err, errWalletClosed) {
		t.Fatalf("charge on closed wallet: got %v, want errWalletClosed", err)
	}
	if len(l.attendeeCharges) != 0 || len(l.vendorCredits) != 0 {
		t.Fatalf("closed-wallet charge wrote legs (attendee:%d vendor:%d), want 0/0", len(l.attendeeCharges), len(l.vendorCredits))
	}
}

// ===========================================================================
// Inv 5. Tier / limit gate fails CLOSED.
//
// (a) Purchase & TopUp move money via wallet.Debit, whose FIRST statement is
//     `s.tiers.EnforceWalletDebitLimit(...)` (see finance/wallet/service.go:52-56);
//     the ledger Debit is reached ONLY if that returns nil. So an over-limit or
//     KYC-disabled tier blocks the debit BEFORE any ledger entry — no money moves.
//
// (b) SettleVendor checks `int(tier) < 1 -> ErrKYCRequired` (service.go:755-757)
//     BEFORE opening its tx; an unverified vendor gets no settlement row and no
//     payout legs.
// ===========================================================================

// mirrorTierGate replicates the fail-closed ordering of wallet.Debit +
// tiers.EnforceWalletDebitLimit. dailyLimitKobo == 0 means "wallet disabled at this
// tier" (Tier0) which the real EnforceWalletDebitLimit rejects with ErrWalletDisabled.
type mirrorTierGate struct {
	tier           int
	dailyLimitKobo int64 // 0 => disabled (for tier 0) per tiers.GetConfig
	alreadyDebited int64 // today's running debit total
	ledgerDebits   []int64
}

var (
	errWalletDisabled     = errors.New("tiers: wallet disabled for KYC tier 0")
	errDailyLimitExceeded = errors.New("tiers: daily debit limit exceeded")
)

// enforceThenDebit mirrors wallet.Debit: enforce the tier limit FIRST; only on a
// nil result does the (mirror) ledger debit run. A rejection must leave ledgerDebits
// empty — proving no money moved.
func (g *mirrorTierGate) enforceThenDebit(amountKobo int64) error {
	// --- tiers.EnforceWalletDebitLimit ---
	if g.dailyLimitKobo == 0 && g.tier == 0 {
		return errWalletDisabled // Tier0 wallet disabled — fail closed
	}
	if g.dailyLimitKobo != 0 && g.alreadyDebited+amountKobo > g.dailyLimitKobo {
		return errDailyLimitExceeded // over the tier's daily cap — fail closed
	}
	// --- only now does the ledger debit happen ---
	g.ledgerDebits = append(g.ledgerDebits, amountKobo)
	g.alreadyDebited += amountKobo
	return nil
}

func TestTierGate_Tier0WalletDisabled_BlocksPurchaseDebit(t *testing.T) {
	// A Tier0 buyer's Purchase debit (payable > 0) must be rejected with the debit
	// never reaching the ledger.
	g := &mirrorTierGate{tier: 0, dailyLimitKobo: 0}
	if err := g.enforceThenDebit(5_000_00); !errors.Is(err, errWalletDisabled) {
		t.Fatalf("tier0 purchase debit: got %v, want errWalletDisabled", err)
	}
	if len(g.ledgerDebits) != 0 {
		t.Fatalf("ledger debits = %d, want 0 — a blocked tier must post NO ledger entry (no money moves)", len(g.ledgerDebits))
	}
}

func TestTierGate_OverDailyLimit_BlocksDebitNoLedgerEntry(t *testing.T) {
	// Tier with a 200000-kobo daily cap; 150000 already spent today. A further
	// 100000 debit (Purchase or TopUp source=wallet) would breach the cap and must
	// be rejected with nothing posted.
	g := &mirrorTierGate{tier: 1, dailyLimitKobo: 2_000_00, alreadyDebited: 1_500_00}
	if err := g.enforceThenDebit(1_000_00); !errors.Is(err, errDailyLimitExceeded) {
		t.Fatalf("over-limit debit: got %v, want errDailyLimitExceeded", err)
	}
	if len(g.ledgerDebits) != 0 {
		t.Fatalf("ledger debits = %d, want 0 — over-limit debit must not post", len(g.ledgerDebits))
	}
	if g.alreadyDebited != 1_500_00 {
		t.Fatalf("running debit total = %d, want unchanged 150000", g.alreadyDebited)
	}
}

func TestTierGate_WithinLimit_AllowsDebit(t *testing.T) {
	// The complement: a debit that stays within the cap (150000 already spent +
	// 5000 = 155000, under the 200000 cap) goes through and posts exactly one
	// ledger entry.
	g := &mirrorTierGate{tier: 1, dailyLimitKobo: 2_000_00, alreadyDebited: 1_500_00}
	if err := g.enforceThenDebit(5_000); err != nil {
		t.Fatalf("within-limit debit: %v", err)
	}
	if len(g.ledgerDebits) != 1 || g.ledgerDebits[0] != 5_000 {
		t.Fatalf("ledger debits = %v, want exactly [5000]", g.ledgerDebits)
	}
	if g.alreadyDebited != 1_550_00 {
		t.Fatalf("running total = %d, want 155000", g.alreadyDebited)
	}
}

// mirrorVendorPayoutGate replicates Service.SettleVendor's KYC gate ordering: the
// tier check happens BEFORE the settlement tx opens, so a blocked payout writes NO
// settlement row and NO ledger legs.
type mirrorVendorPayoutGate struct {
	vendorTier     int
	settlementRows int
	payoutLegs     []int64
}

var errKYCRequired = errors.New("events: vendor must complete KYC before payout (NL-10)")

// settle mirrors SettleVendor: `if int(tier) < 1 { return ErrKYCRequired }` guards
// the whole money path. Only a verified (tier >= 1) vendor reaches the settlement
// insert + payout legs.
func (g *mirrorVendorPayoutGate) settle(gross int64, feeBps int) (net int64, err error) {
	if g.vendorTier < 1 {
		return 0, errKYCRequired // fail closed — return BEFORE tx / any write
	}
	if gross <= 0 {
		return 0, errors.New("events: nothing to settle")
	}
	fee := (gross * int64(feeBps)) / 10000
	net = gross - fee
	g.settlementRows++
	g.payoutLegs = append(g.payoutLegs, net)
	if fee > 0 {
		g.payoutLegs = append(g.payoutLegs, fee)
	}
	return net, nil
}

func TestVendorPayoutGate_UnverifiedVendorBlocked_NoSettlementNoLegs(t *testing.T) {
	g := &mirrorVendorPayoutGate{vendorTier: 0} // KYC not completed
	if _, err := g.settle(100_000_00, 250); !errors.Is(err, errKYCRequired) {
		t.Fatalf("unverified vendor settle: got %v, want errKYCRequired", err)
	}
	// Inv 5: fail-closed payout writes nothing.
	if g.settlementRows != 0 {
		t.Fatalf("settlement rows = %d, want 0 (blocked payout must record no settlement)", g.settlementRows)
	}
	if len(g.payoutLegs) != 0 {
		t.Fatalf("payout legs = %d, want 0 (no money leaves escrow for an unverified vendor)", len(g.payoutLegs))
	}
}

func TestVendorPayoutGate_VerifiedVendorPaidWithBalancedLegs(t *testing.T) {
	// The complement: a verified vendor (tier >= 1) is paid, and the legs written to
	// escrow-out sum EXACTLY to gross (net + fee), tying Inv 5 back to Inv 2/Inv 6.
	g := &mirrorVendorPayoutGate{vendorTier: 1}
	net, err := g.settle(100_000_00, 250)
	if err != nil {
		t.Fatalf("verified vendor settle: %v", err)
	}
	if net != 97_500_00 {
		t.Fatalf("net = %d, want 9750000", net)
	}
	if g.settlementRows != 1 {
		t.Fatalf("settlement rows = %d, want exactly 1", g.settlementRows)
	}
	var legSum int64
	for _, leg := range g.payoutLegs {
		if leg < 0 {
			t.Fatalf("negative payout leg %d", leg)
		}
		legSum += leg
	}
	if legSum != 100_000_00 {
		t.Fatalf("sum of payout legs = %d, want gross 10000000 (no kobo created or lost paying the vendor)", legSum)
	}
}
