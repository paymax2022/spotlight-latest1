package recon

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// StoredBreak is a Break plus its lifecycle fields.
type StoredBreak struct {
	Break
	RunID      string
	Status     string // open | resolved
	Owner      string
	ResolvedAt *time.Time
	Resolution string
}

// MemStore is an in-process Store (tests).
type MemStore struct {
	mu     sync.Mutex
	runs   int
	breaks []StoredBreak
}

func NewMemStore() *MemStore { return &MemStore{} }

func (m *MemStore) StartRun(context.Context, string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runs++
	return fmt.Sprintf("run-%d", m.runs), nil
}

func (m *MemStore) RecordBreak(_ context.Context, runID string, b Break) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range m.breaks {
		if e.Status == "open" && e.DedupeKey() == b.DedupeKey() {
			return false, nil
		}
	}
	m.breaks = append(m.breaks, StoredBreak{Break: b, RunID: runID, Status: "open"})
	return true, nil
}

func (m *MemStore) FinishRun(context.Context, string, int, int, int) error { return nil }

// Breaks returns a copy of every stored break.
func (m *MemStore) Breaks() []StoredBreak {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]StoredBreak(nil), m.breaks...)
}

// Resolve closes the open break with the given dedupe key.
func (m *MemStore) Resolve(key, resolution string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for i := range m.breaks {
		if m.breaks[i].Status == "open" && m.breaks[i].DedupeKey() == key {
			m.breaks[i].Status, m.breaks[i].Resolution, m.breaks[i].ResolvedAt = "resolved", resolution, &now
		}
	}
}

// PGStore persists runs/breaks in crossborder_recon_runs / _breaks (pgx,
// service_role). Dedupe is enforced by a partial unique index on open breaks.
type PGStore struct{ db *pgxpool.Pool }

func NewPGStore(db *pgxpool.Pool) *PGStore { return &PGStore{db: db} }

func (s *PGStore) StartRun(ctx context.Context, check string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO public.crossborder_recon_runs (check_name) VALUES ($1) RETURNING id::text`, check).Scan(&id)
	return id, err
}

func (s *PGStore) RecordBreak(ctx context.Context, runID string, b Break) (bool, error) {
	tag, err := s.db.Exec(ctx, `
		INSERT INTO public.crossborder_recon_breaks
			(run_id, check_name, type, severity, ref_a, ref_b, delta_minor, detail, dedupe_key)
		VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (dedupe_key) WHERE status = 'open' DO NOTHING`,
		runID, b.Check, string(b.Type), string(b.Severity), b.RefA, b.RefB, b.Delta, b.Detail, b.DedupeKey())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *PGStore) FinishRun(ctx context.Context, runID string, detected, created, redriven int) error {
	_, err := s.db.Exec(ctx, `UPDATE public.crossborder_recon_runs
		SET finished_at = now(), breaks_detected = $2, breaks_created = $3, redriven = $4 WHERE id = $1::uuid`,
		runID, detected, created, redriven)
	return err
}
