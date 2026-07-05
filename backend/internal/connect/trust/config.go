// Package connecttrust holds Phase-5 trust + safety intelligence for Paymax
// Connect: config-driven warning/scam detection, the scam-shield store (reason
// codes surfaced to moderators), and the guardrailed AI coach/assistant.
//
// IRON RULE: every threshold, weight, and trigger-term list is backend-owned and
// read from public.connect_config — NOTHING is hard-coded here. See
// docs/prd/dating/{compliance.md (invariants 8,10), acceptance.md §Phase 5}.
package connecttrust

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Config keys (rows in public.connect_config). Values, not the keys, carry the
// tunable data — the keys are the contract between this code and the DB seed.
const (
	keyFinancialTerms   = "moderation.financial_solicitation_terms"
	keyOffPlatformTerms = "safety.warning.off_platform_terms"
	keyHarassmentTerms  = "safety.warning.harassment_terms"
	keyFlagToCase       = "safety.scam_shield.flag_to_case_threshold"
	keyEscalateScore    = "safety.scam_shield.escalate_score"
)

// Thresholds is a point-in-time snapshot of the backend-owned safety config.
type Thresholds struct {
	FinancialTerms   []string
	OffPlatformTerms []string
	HarassmentTerms  []string
	FlagToCase       int
	EscalateScore    int
}

// ConfigReader loads safety thresholds from public.connect_config. It is the
// single source of truth so detection logic stays config-driven, never literal.
type ConfigReader struct{ db *pgxpool.Pool }

// NewConfigReader builds a reader over the shared pgx pool.
func NewConfigReader(db *pgxpool.Pool) *ConfigReader { return &ConfigReader{db: db} }

// Load reads all safety thresholds in one round-trip. Missing rows yield empty
// term lists and zero thresholds — detection then fails OPEN as "no warning"
// for term lists, but the caller must treat a load error as fail-closed.
func (r *ConfigReader) Load(ctx context.Context) (Thresholds, error) {
	const q = `SELECT key, value FROM connect_config WHERE key = ANY($1)`
	keys := []string{keyFinancialTerms, keyOffPlatformTerms, keyHarassmentTerms, keyFlagToCase, keyEscalateScore}
	rows, err := r.db.Query(ctx, q, keys)
	if err != nil {
		return Thresholds{}, fmt.Errorf("connect: load safety config: %w", err)
	}
	defer rows.Close()

	var t Thresholds
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return Thresholds{}, fmt.Errorf("connect: scan safety config: %w", err)
		}
		switch key {
		case keyFinancialTerms:
			t.FinancialTerms = decodeStrings(raw)
		case keyOffPlatformTerms:
			t.OffPlatformTerms = decodeStrings(raw)
		case keyHarassmentTerms:
			t.HarassmentTerms = decodeStrings(raw)
		case keyFlagToCase:
			t.FlagToCase = decodeInt(raw)
		case keyEscalateScore:
			t.EscalateScore = decodeInt(raw)
		}
	}
	return t, rows.Err()
}

func decodeStrings(raw []byte) []string {
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func decodeInt(raw []byte) int {
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0
	}
	return n
}
