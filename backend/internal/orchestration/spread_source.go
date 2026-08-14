package orchestration

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Durable spread rule card, shared with the legacy wallet FX service (ADR-032).
//
// public.fx_markup_rates is the SINGLE source of truth for Paymax FX markup
// across both FX surfaces: the legacy /api/finance/fx service and this
// orchestration module. Before ADR-032 the two priced independently — this
// module from an in-code rule table in finance_routes.go, the legacy service
// from the DB — so the same corridor could be charged two different markups and
// only one of them was operator-changeable.
//
// The table is read directly rather than through finance/fx to keep the
// dependency direction clean: it is a shared platform config table, and having
// orchestration import the legacy service purely to read a rate would couple the
// new module to the one it supersedes.
//
// The DEFAULT corridor row and the '' tier are wildcards, matching
// SpreadEngine.resolve's "empty means any" semantics.
// ---------------------------------------------------------------------------

// sqlSpreadSource loads the rule card from public.fx_markup_rates.
type sqlSpreadSource struct {
	db *pgxpool.Pool
}

// NewSQLSpreadSource returns a SpreadSource over the shared markup table
// (requires the 20261204000000_fx_markup_rates migration).
func NewSQLSpreadSource(db *pgxpool.Pool) SpreadSource { return &sqlSpreadSource{db: db} }

// LoadRules reads every active row and shapes it into the engine's rule form.
//
// The 'DEFAULT' corridor row becomes the engine's flat default (Corridor ""),
// and every other row becomes a SpreadRule keyed on corridor and, where set,
// tier — which is exactly how resolve() scores specificity (corridor+tier >
// corridor > tier > default).
//
// A missing DEFAULT row is an ERROR, not a zero or a silent fallback: the seed
// migration guarantees one, so its absence means the table is not what this code
// expects, and guessing a spread would mean charging a rate nobody configured.
func (s *sqlSpreadSource) LoadRules(ctx context.Context) (int, []SpreadRule, error) {
	const q = `
		SELECT corridor, tier, rate_bps, COALESCE(min_bps, 0), COALESCE(max_bps, 0)
		FROM public.fx_markup_rates
		WHERE active
		ORDER BY corridor, tier`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return 0, nil, fmt.Errorf("orchestration: load spread rules: %w", err)
	}
	defer rows.Close()

	defaultBPS := -1
	out := make([]SpreadRule, 0, 8)
	for rows.Next() {
		var corridor, tier string
		var bps, minBPS, maxBPS int
		if err := rows.Scan(&corridor, &tier, &bps, &minBPS, &maxBPS); err != nil {
			return 0, nil, fmt.Errorf("orchestration: scan spread rule: %w", err)
		}
		if corridor == markupDefaultCorridor && tier == "" {
			defaultBPS = bps
			continue
		}
		rule := SpreadRule{BPS: bps, MinBPS: minBPS, MaxBPS: maxBPS}
		if corridor != markupDefaultCorridor {
			rule.Corridor = corridor
		}
		rule.Tier = tier
		out = append(out, rule)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, fmt.Errorf("orchestration: read spread rules: %w", err)
	}
	if defaultBPS < 0 {
		return 0, nil, fmt.Errorf("orchestration: no active '%s' row in fx_markup_rates — refusing to price without a configured default spread", markupDefaultCorridor)
	}
	return defaultBPS, out, nil
}

// markupDefaultCorridor is the wildcard corridor label in fx_markup_rates. It
// mirrors fx.DefaultCorridor; the constant is repeated rather than imported so
// orchestration does not depend on the legacy FX package (see file header).
const markupDefaultCorridor = "DEFAULT"
