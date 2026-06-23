package connectconfig

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service reads backend-owned Connect config from public.connect_config.
// It is read-only here (Phase 0); admin writes arrive in a later slice.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// PublicConfig returns the key→value map of rows safe to expose to mobile
// (visibility = 'public'). This is what GET /api/v1/connect/config serves.
func (s *Service) PublicConfig(ctx context.Context) (map[string]json.RawMessage, error) {
	const q = `SELECT key, value FROM connect_config WHERE visibility = 'public' ORDER BY key`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("connect: query public config: %w", err)
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var key string
		var value []byte
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("connect: scan config: %w", err)
		}
		out[key] = json.RawMessage(value)
	}
	return out, rows.Err()
}

// AllConfig returns every config entry (public + internal) for admin views.
// Authorization is enforced at the route layer (connect.config.view).
func (s *Service) AllConfig(ctx context.Context) ([]Entry, error) {
	const q = `SELECT key, value, scope, visibility, COALESCE(description,'')
	           FROM connect_config ORDER BY key`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("connect: query all config: %w", err)
	}
	defer rows.Close()

	var out []Entry
	for rows.Next() {
		var e Entry
		var value []byte
		if err := rows.Scan(&e.Key, &value, &e.Scope, &e.Visibility, &e.Description); err != nil {
			return nil, fmt.Errorf("connect: scan config: %w", err)
		}
		e.Value = json.RawMessage(value)
		out = append(out, e)
	}
	return out, rows.Err()
}
