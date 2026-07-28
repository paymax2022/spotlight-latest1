package social

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AMLConfig is versioned velocity policy for P2P sends (NL-10). Defaults are
// conservative; admin tooling can override per-tier in later phases.
type AMLConfig struct {
	MaxSendsPerDay   int   // count cap in a rolling 24h window
	MaxAmountPerDay  int64 // total kobo cap in a rolling 24h window
	MaxSingleKobo    int64 // single-transfer cap
}

// DefaultAMLConfig is the closed-loop default applied when none is supplied.
func DefaultAMLConfig() AMLConfig {
	return AMLConfig{
		MaxSendsPerDay:  50,
		MaxAmountPerDay: 50000000, // ₦500,000 / day
		MaxSingleKobo:   20000000, // ₦200,000 single
	}
}

// AML enforces send velocity / structuring limits against the recorded P2P
// payment history (NL-10). It fails CLOSED: a DB error blocks the transfer.
type AML struct {
	db  *pgxpool.Pool
	cfg AMLConfig
}

func NewAML(db *pgxpool.Pool, cfg AMLConfig) *AML {
	if cfg.MaxSendsPerDay == 0 {
		cfg = DefaultAMLConfig()
	}
	return &AML{db: db, cfg: cfg}
}

// Check verifies a proposed send of amountKobo by senderID is within limits.
func (a *AML) Check(ctx context.Context, senderID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("social: amount must be positive")
	}
	if amountKobo > a.cfg.MaxSingleKobo {
		return ErrAMLSingleLimit
	}
	const q = `
		SELECT COALESCE(COUNT(*),0), COALESCE(SUM(amount_kobo),0)
		FROM social_payments
		WHERE sender_id=$1 AND created_at > now() - interval '24 hours'`
	var cnt int
	var sum int64
	if err := a.db.QueryRow(ctx, q, senderID).Scan(&cnt, &sum); err != nil {
		return fmt.Errorf("social: aml check failed (fail-closed): %w", err)
	}
	if cnt+1 > a.cfg.MaxSendsPerDay {
		return ErrAMLCountLimit
	}
	if sum+amountKobo > a.cfg.MaxAmountPerDay {
		return ErrAMLAmountLimit
	}
	return nil
}

var (
	ErrAMLSingleLimit = fmt.Errorf("social: transfer exceeds single-send limit")
	ErrAMLCountLimit  = fmt.Errorf("social: daily transfer count limit reached")
	ErrAMLAmountLimit = fmt.Errorf("social: daily transfer amount limit reached")
)
