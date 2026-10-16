package orchestration

import (
	"context"
	"errors"
	"log"

	"spotlight/backend/internal/crossborder/revenue"
)

// SpreadRecognizer recognises the FX spread of an executed trade (SP-3a Task 4):
// native-currency line + receivable accrual + NGN roll-up to commission.
// *revenue.Recognizer satisfies it. Optional: nil leaves the pre-Task-4
// behaviour (the orch book posts `paymax_spread`, nothing reaches commission).
type SpreadRecognizer interface {
	RecognizeFXSpread(ctx context.Context, t revenue.FXSpreadTrade) error
}

// WithSpreadRecognizer wires revenue recognition into the execute paths.
func WithSpreadRecognizer(r SpreadRecognizer) ServiceOption {
	return func(s *Service) { s.spreadRecognizer = r }
}

// recognizeSpread is called AFTER the trade is durably applied. It is strictly
// best-effort and read-only with respect to FX money: a failure is logged and
// retried on the next idempotent replay of the same execute call; it can never
// fail or alter the trade. The recognised spread is exactly what ApplyConversion /
// ApplyTransfer posted to `paymax_spread` (same splitSpread rule), so the native
// line is not double-counted.
func (s *Service) recognizeSpread(ctx context.Context, service, reference, customerID string, src, dst Money, fees []Fee) {
	if s.spreadRecognizer == nil {
		return
	}
	sourceTotal := src.AmountMinor + feeAmount(fees, FeeProvider) + feeAmount(fees, FeeRail)
	spread, _ := splitSpread(feeAmount(fees, FeeSpread), sourceTotal)
	if spread <= 0 {
		return
	}
	// NGN rate = the trade's own recorded amounts (integer ratio), never a float
	// and never an outside source. Neither leg NGN => no rate => no roll-up.
	var rate revenue.Rate
	switch {
	case src.Currency == "NGN":
		rate = revenue.NGN
	case dst.Currency == "NGN" && src.AmountMinor > 0 && dst.AmountMinor > 0:
		rate = revenue.Rate{Num: dst.AmountMinor, Den: src.AmountMinor}
	}
	err := s.spreadRecognizer.RecognizeFXSpread(ctx, revenue.FXSpreadTrade{
		TransferID: reference, Service: service, UserID: customerID, Currency: src.Currency,
		SpreadMinor: spread, GrossMinor: src.AmountMinor, Rate: rate,
	})
	if err != nil {
		if errors.Is(err, revenue.ErrNoNGNRate) {
			log.Printf("orchestration: fx spread %s not rolled up to NGN (no NGN leg, %s->%s)", reference, src.Currency, dst.Currency)
			return
		}
		log.Printf("orchestration: fx spread recognition for %s failed (will retry on replay): %v", reference, err)
	}
}
