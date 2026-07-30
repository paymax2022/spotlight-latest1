package commission

import "context"

// Recorder is the dependency-light seam other modules use to record realized
// Spotlight profit into the central commission registry WITHOUT importing the
// module's internals or DB types. The existing *Service satisfies it, so wiring is
// a one-liner and the dependency can be injected nil-safe (a nil Recorder ⇒ no-op
// on the caller's side; see each caller's recordCommissionSafe helper).
//
// This is purely additive: it exposes the already-implemented idempotent
// RecordEarning under a small, stable interface plus a convenience form that fills
// the EarningInput for the common "category/service/subtype + gross + source" call.
type Recorder interface {
	// Record idempotently records realized profit for one source transaction. The
	// fee breakdown is derived server-side from the active rate card (never trusted
	// from the caller); a duplicate idempotencyKey is a safe no-op that returns the
	// original row. This is a straight pass-through to RecordEarning.
	Record(ctx context.Context, in EarningInput, idempotencyKey string) (*Earning, error)

	// RecordFor is the convenience form: the caller passes the config coordinates
	// (category/service/subtype), the gross amount in kobo, and provenance
	// (sourceModule/sourceRef/userID) + an idempotency key. The breakdown is
	// resolved and computed by the central config via RecordEarning → the recorded
	// earning can never drift from the active rate card.
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) (*Earning, error)

	// RecordExact is the exact-fee form: the caller passes BOTH the gross (principal,
	// for context) and the ACTUAL realized fee it earned (recordedRevenueKobo). The
	// recorded profit is the caller's fee verbatim — NOT config% × gross. This is the
	// correct path for fixed-fee / spread modules (transfers, fx, jobs, association,
	// savings) where a %-of-gross figure would mis-state profit. config_id is still
	// resolved for reporting joins but never drives the amount. Idempotent like Record.
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) (*Earning, error)
}

// Record satisfies Recorder. It delegates verbatim to RecordEarning — behavior is
// unchanged (idempotent, server-side breakdown, optional ledger recognition).
func (s *Service) Record(ctx context.Context, in EarningInput, idempotencyKey string) (*Earning, error) {
	return s.RecordEarning(ctx, in, idempotencyKey)
}

// RecordFor builds the EarningInput from the caller's coordinates and delegates to
// RecordEarning, which resolves the active config and computes the breakdown via the
// shared computeBreakdown core (the same math the /calculate endpoint uses). Currency
// defaults to the resolved config's currency inside RecordEarning when left empty.
func (s *Service) RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceModule, sourceRef string, userID *string, idempotencyKey string) (*Earning, error) {
	return s.RecordEarning(ctx, EarningInput{
		ServiceCategory: category,
		Service:         service,
		ServiceSubtype:  subtype,
		GrossAmountKobo: grossKobo,
		SourceModule:    sourceModule,
		SourceRef:       sourceRef,
		UserID:          userID,
	}, idempotencyKey)
}

// Compile-time assertion that *Service implements the Recorder seam.
var _ Recorder = (*Service)(nil)
