package gateway

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DBRailResolver implements RailResolver from the stays_supplier_config table
// (admin-managed). It is the data-driven routing table: which adapter serves which
// (rail, supplier) and which rails are active for search fan-out. Keeping it behind
// the RailResolver interface keeps the gateway free of a DB import cycle.
type DBRailResolver struct {
	db *pgxpool.Pool
}

// NewDBRailResolver constructs the DB-backed resolver.
func NewDBRailResolver(db *pgxpool.Pool) *DBRailResolver { return &DBRailResolver{db: db} }

// ResolveAdapter returns the adapter key for an active (rail, supplierCode).
func (r *DBRailResolver) ResolveAdapter(ctx context.Context, rail SourceRail, supplierCode string) (string, bool) {
	if r.db == nil {
		return "", false
	}
	var adapter string
	err := r.db.QueryRow(ctx, `
		SELECT adapter FROM public.stays_supplier_config
		WHERE source_rail = $1 AND supplier_code = $2 AND active = true
		LIMIT 1`, string(rail), supplierCode).Scan(&adapter)
	if err != nil || adapter == "" {
		return "", false
	}
	return adapter, true
}

// ActiveRails returns the rails+adapters enabled for fan-out search.
func (r *DBRailResolver) ActiveRails(ctx context.Context) []RailBinding {
	if r.db == nil {
		return nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT source_rail, adapter FROM public.stays_supplier_config
		WHERE active = true`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []RailBinding
	for rows.Next() {
		var rail, adapter string
		if err := rows.Scan(&rail, &adapter); err != nil {
			continue
		}
		out = append(out, RailBinding{Rail: SourceRail(rail), Adapter: adapter})
	}
	return out
}

// StaticRailResolver is a config-driven resolver used in tests / when the supplier
// table is empty (e.g. sandbox bring-up): both rails active, each mapped to its
// adapter name.
type StaticRailResolver struct {
	Bindings map[SourceRail]string // rail → adapter name
}

// ResolveAdapter returns the static adapter for a rail (supplierCode ignored).
func (r StaticRailResolver) ResolveAdapter(ctx context.Context, rail SourceRail, supplierCode string) (string, bool) {
	a, ok := r.Bindings[rail]
	return a, ok
}

// ActiveRails returns all statically-bound rails.
func (r StaticRailResolver) ActiveRails(ctx context.Context) []RailBinding {
	out := make([]RailBinding, 0, len(r.Bindings))
	for rail, adapter := range r.Bindings {
		out = append(out, RailBinding{Rail: rail, Adapter: adapter})
	}
	return out
}
