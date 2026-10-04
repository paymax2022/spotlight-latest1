package gateway

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// This package defines the provider-agnostic STAYS supply gateway. It MIRRORS the
// maps adapter pattern (internal/maps/adapter.go) and the insurance gateway
// (internal/insurance/gateway): one small interface, concrete per-rail adapters
// (internal/stays/adapters), and a Router that resolves an adapter from data.
// INVARIANT: only NORMALISED models cross this boundary. Supplier JSON never
// leaks past an adapter — adapters translate to/from the structs in models.go.
// The two-step prebook→book contract lives here: Prebook re-validates live price +
// availability and returns a short-lived book_token; Book consumes it idempotently.

// Named is implemented by every adapter so usage/metrics + logs can identify the
// supply rail/supplier a call was dispatched to (mirrors maps.Named).
type Named interface {
	// Name returns a stable adapter id, e.g. "bedbank", "direct".
	Name() string
}

// SupplyGateway is the single, provider-agnostic capability interface every supply
// adapter implements. Feature code (the reservation service) depends ONLY on this
// interface; adding a supplier is a new adapter + config, never a core change.
//   - Search re-fans across rails (done by Router.Search) and each adapter returns
//     its own normalised offers; dedup + best-bookable-rate selection sit ABOVE the
//     adapters in the dedup package.
//   - Prebook MUST re-check live price + availability and return a short-lived
//     book_token. This is mandatory — it closes the price-drift / sold-out gap.
//   - Book MUST be idempotent on (IdempotencyKey + BookToken): a retried book
//     returns the same reservation, never a second supplier booking. This is
//     load-bearing for the hold→charge→release saga.
type SupplyGateway interface {
	Named

	// Search returns this adapter's normalised offers for the request. A supplier
	// timeout MUST surface as an error so the Router can drop that rail and still
	// return the other rail's results (graceful per-rail degradation).
	Search(ctx context.Context, req SearchRequest) ([]PropertyOffer, error)
	// GetContent returns normalised property content for a supplier property ref.
	GetContent(ctx context.Context, supplierPropertyRef string) (PropertyContent, error)
	// Prebook re-validates live price + availability and returns a book_token.
	Prebook(ctx context.Context, req PrebookRequest) (PrebookResult, error)
	// Book consumes a book_token and is idempotent on IdempotencyKey + BookToken.
	Book(ctx context.Context, req BookRequest) (Reservation, error)
	// GetReservation returns the supplier-side reservation by supplier ref.
	GetReservation(ctx context.Context, supplierRef string) (Reservation, error)
	// Cancel cancels a reservation at the supplier (idempotent on the supplier ref).
	Cancel(ctx context.Context, req CancelRequest) (Cancellation, error)
	// Modify re-prices/re-books a delta (dates/occupancy) at the supplier.
	Modify(ctx context.Context, req ModifyRequest) (Reservation, error)
	// SyncARI pushes availability/rate/restriction events. Rail B (direct) only;
	// Rail A adapters return ErrUnsupported.
	SyncARI(ctx context.Context, ev ARIEvent) error
}

// ErrUnsupported is returned by an adapter for a capability the rail does not
// serve (e.g. SyncARI on a bedbank rail).
var ErrUnsupported = fmt.Errorf("stays gateway: capability not supported by this rail")

// RailResolver maps a SourceRail + supplier code to the adapter Name() that serves
// it. The supplier-config table (stays admin) implements this; keeping it an
// interface keeps the gateway free of a DB import cycle and routing data-driven.
type RailResolver interface {
	// ResolveAdapter returns the adapter key for a (rail, supplierCode). ok is
	// false when the supplier is unknown or inactive.
	ResolveAdapter(ctx context.Context, rail SourceRail, supplierCode string) (adapter string, ok bool)
	// ActiveRails returns the rails enabled for fan-out search, each with the
	// adapter key that serves it. Used by Router.Search.
	ActiveRails(ctx context.Context) []RailBinding
}

// RailBinding pairs a rail with the adapter that serves it for search fan-out.
type RailBinding struct {
	Rail    SourceRail
	Adapter string
}

// Router resolves the concrete adapter(s) for a rail/supplier via the resolver and
// fans Search out across active rails. It mirrors maps.Service.resolve and the
// insurance gateway.Router: a config/data lookup, then a registry lookup.
type Router struct {
	resolver RailResolver
	adapters map[string]SupplyGateway // keyed by adapter Name()
}

// NewRouter builds a router over a rail resolver and the registered adapters.
func NewRouter(resolver RailResolver, adapters ...SupplyGateway) *Router {
	m := make(map[string]SupplyGateway, len(adapters))
	for _, a := range adapters {
		if a != nil {
			m[a.Name()] = a
		}
	}
	return &Router{resolver: resolver, adapters: m}
}

// ErrNoAdapter is returned when no adapter is configured/registered for a
// rail+supplier (or the supplier is unknown/inactive).
var ErrNoAdapter = fmt.Errorf("stays gateway: no adapter for rail/supplier")

// Resolve returns the SupplyGateway for a (rail, supplierCode). The rail+supplier
// → adapter mapping lives entirely in the supplier-config data; this performs no
// per-supplier branching.
func (r *Router) Resolve(ctx context.Context, rail SourceRail, supplierCode string) (SupplyGateway, error) {
	if r == nil || r.resolver == nil {
		return nil, ErrNoAdapter
	}
	adapter, ok := r.resolver.ResolveAdapter(ctx, rail, supplierCode)
	if !ok || adapter == "" {
		return nil, fmt.Errorf("%w: %s/%s", ErrNoAdapter, rail, supplierCode)
	}
	gw, ok := r.adapters[adapter]
	if !ok {
		return nil, fmt.Errorf("%w: adapter %q not registered", ErrNoAdapter, adapter)
	}
	return gw, nil
}

// Adapter returns a registered adapter by name (used by ARI/webhook ingestion,
// which routes on the URL path or rail, not on a supplier lookup).
func (r *Router) Adapter(name string) (SupplyGateway, bool) {
	if r == nil {
		return nil, false
	}
	gw, ok := r.adapters[name]
	return gw, ok
}

// Search fans the request out across every ACTIVE rail and merges the per-rail
// normalised offers. A failing rail is dropped (its error is collected, not
// returned) so one supplier being down never blocks the whole search — the
// graceful-degradation invariant. Dedup + best-bookable-rate selection happen
// ABOVE this, in the dedup package, on the merged slice.
func (r *Router) Search(ctx context.Context, req SearchRequest) ([]PropertyOffer, []RailError) {
	if r == nil || r.resolver == nil {
		return nil, []RailError{{Err: ErrNoAdapter}}
	}
	var (
		merged []PropertyOffer
		errs   []RailError
	)
	for _, b := range r.resolver.ActiveRails(ctx) {
		gw, ok := r.adapters[b.Adapter]
		if !ok {
			errs = append(errs, RailError{Rail: b.Rail, Adapter: b.Adapter, Err: ErrNoAdapter})
			continue
		}
		offers, err := gw.Search(ctx, req)
		if err != nil {
			// Drop this rail; the other rail's results still return.
			errs = append(errs, RailError{Rail: b.Rail, Adapter: b.Adapter, Err: err})
			continue
		}
		merged = append(merged, offers...)
	}
	return merged, errs
}

// RailError records a single rail's search failure for observability (the search
// still succeeds with the surviving rails' results).
type RailError struct {
	Rail    SourceRail
	Adapter string
	Err     error
}

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
