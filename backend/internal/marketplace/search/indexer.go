package search

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// outboxBatchSize bounds how many mkt_listings_outbox rows RunOnce drains per
// call, so a large backlog doesn't turn one tick into an unbounded transaction.
const outboxBatchSize = 200

// outboxRow is the local shape read from mkt_listings_outbox. It intentionally
// mirrors marketplace.OutboxRow (SWARM_INTEGRATION_CONTRACT.md) field-for-field
// without importing package marketplace — this package must stay import-cycle
// free and buildable even before Agent A's package compiles.
type outboxRow struct {
	ID        int64
	ListingID string
	Op        string // "upsert" | "delete"
	Payload   json.RawMessage
	CreatedAt time.Time
}

// Indexer drains mkt_listings_outbox (written by package marketplace on every
// listing state change that affects search — §2.1) and applies the
// corresponding upsert/delete to Elasticsearch. Idempotent: re-running over
// already-processed rows is impossible because processed rows are excluded by
// the WHERE processed_at IS NULL clause, and re-applying the same unprocessed
// row twice (e.g. after a crash before the UPDATE commits) is a safe no-op
// because ES upsert/delete-by-id are themselves idempotent.
type Indexer struct {
	pool   *pgxpool.Pool
	client *Client
}

// NewIndexer wires an Indexer against the shared Postgres pool and an
// Elasticsearch base URL.
func NewIndexer(pool *pgxpool.Pool, esURL string) *Indexer {
	return &Indexer{pool: pool, client: NewClient(esURL)}
}

// RunOnce drains up to outboxBatchSize unprocessed outbox rows, applies each
// to Elasticsearch (upsert or delete), and marks it processed. Returns the
// count of rows successfully processed. A per-row ES failure is logged and
// that row is left unprocessed for the next tick (at-least-once delivery);
// it never blocks or drops the rest of the batch.
func (i *Indexer) RunOnce(ctx context.Context) (int, error) {
	if i.pool == nil {
		return 0, errors.New("search: indexer has no database pool")
	}

	rows, err := i.pool.Query(ctx, `
		SELECT id, listing_id, op, payload, created_at
		FROM mkt_listings_outbox
		WHERE processed_at IS NULL
		ORDER BY created_at
		LIMIT $1`, outboxBatchSize)
	if err != nil {
		return 0, fmt.Errorf("search: query outbox: %w", err)
	}

	var batch []outboxRow
	for rows.Next() {
		var r outboxRow
		if err := rows.Scan(&r.ID, &r.ListingID, &r.Op, &r.Payload, &r.CreatedAt); err != nil {
			rows.Close()
			return 0, fmt.Errorf("search: scan outbox row: %w", err)
		}
		batch = append(batch, r)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("search: iterate outbox rows: %w", err)
	}
	rows.Close()

	processed := 0
	for _, r := range batch {
		var applyErr error
		switch strings.ToLower(r.Op) {
		case "upsert":
			applyErr = i.applyUpsert(ctx, r)
		case "delete":
			applyErr = i.applyDelete(ctx, r)
		default:
			applyErr = fmt.Errorf("unknown outbox op %q", r.Op)
		}

		if applyErr != nil {
			log.Printf("[marketplace-search] indexer: outbox row %d (listing=%s op=%s) failed, will retry: %v",
				r.ID, r.ListingID, r.Op, applyErr)
			continue
		}

		if _, err := i.pool.Exec(ctx,
			`UPDATE mkt_listings_outbox SET processed_at = now() WHERE id = $1 AND processed_at IS NULL`,
			r.ID); err != nil {
			log.Printf("[marketplace-search] indexer: mark row %d processed: %v", r.ID, err)
			continue
		}
		processed++
	}

	return processed, nil
}

// applyUpsert indexes (creates or replaces) one listing document. The
// payload column already carries the fully-shaped ES document (written by
// package marketplace at outbox-insert time), so we forward it as-is.
func (i *Indexer) applyUpsert(ctx context.Context, r outboxRow) error {
	market := marketFromPayload(r.Payload)
	index := fmt.Sprintf(indexAliasFmt, strings.ToLower(market))
	url := fmt.Sprintf("%s/%s/_doc/%s", i.client.baseURL, index, r.ListingID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(r.Payload))
	if err != nil {
		return &ErrSearchUnavailable{Op: "build upsert request", Err: err}
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := i.client.http.Do(req)
	if err != nil {
		return &ErrSearchUnavailable{Op: "upsert document", Err: err}
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return &ErrSearchUnavailable{Op: "upsert document", Err: fmt.Errorf("status %d for listing %s", resp.StatusCode, r.ListingID)}
	}
	return nil
}

// applyDelete removes one listing document from every market-scoped index it
// could plausibly live in. We don't always know the market from a delete
// payload (it may be a minimal {"listing_id": "..."} body), so we attempt the
// market encoded in the payload first, defaulting to "NG"; a 404 from ES on
// delete-by-id is treated as already-deleted (idempotent), not an error.
func (i *Indexer) applyDelete(ctx context.Context, r outboxRow) error {
	market := marketFromPayload(r.Payload)
	index := fmt.Sprintf(indexAliasFmt, strings.ToLower(market))
	url := fmt.Sprintf("%s/%s/_doc/%s", i.client.baseURL, index, r.ListingID)

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return &ErrSearchUnavailable{Op: "build delete request", Err: err}
	}

	resp, err := i.client.http.Do(req)
	if err != nil {
		return &ErrSearchUnavailable{Op: "delete document", Err: err}
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNotFound {
		return &ErrSearchUnavailable{Op: "delete document", Err: fmt.Errorf("status %d for listing %s", resp.StatusCode, r.ListingID)}
	}
	return nil
}

// marketFromPayload best-effort extracts "market_id" from the outbox JSON
// payload, defaulting to "NG" (house doctrine default) when absent/malformed.
func marketFromPayload(payload json.RawMessage) string {
	var probe struct {
		MarketID string `json:"market_id"`
	}
	if err := json.Unmarshal(payload, &probe); err == nil && probe.MarketID != "" {
		return probe.MarketID
	}
	return defaultMarket
}

// DefaultIndexerInterval is the outbox-drain cadence when none is configured.
const DefaultIndexerInterval = 2 * time.Second

// ResolveInterval parses a milliseconds string (e.g. "2000") into a Duration,
// falling back to def for empty / invalid / non-positive input. Pure + testable;
// shared by cmd/marketplace-indexer and the in-process worker path so both honour
// MARKETPLACE_INDEXER_INTERVAL_MS identically.
func ResolveInterval(rawMS string, def time.Duration) time.Duration {
	if rawMS == "" {
		return def
	}
	if ms, err := time.ParseDuration(rawMS + "ms"); err == nil && ms > 0 {
		return ms
	}
	return def
}

// RunIndexerLoop drains mkt_listings_outbox into Elasticsearch on an interval until
// ctx is cancelled. It is the shared body behind BOTH cmd/marketplace-indexer (its
// own process) and the in-process worker path (RUN_WORKERS_INPROCESS) — so a
// single-instance / free-tier deploy can run the search indexer inside the API
// process instead of a separate always-on worker (see ADR-026).
// Best-effort + fail-soft: the mapping-template bootstrap and a down/unreachable ES
// are logged and retried per tick, never fatal. The outbox drain is idempotent, so an
// abrupt stop (SIGTERM) is safe — the next start re-processes any unacked rows.
func RunIndexerLoop(ctx context.Context, pool *pgxpool.Pool, esURL string, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultIndexerInterval
	}
	indexer := NewIndexer(pool, esURL)

	// Best-effort template bootstrap. A fresh/empty ES cluster without the mapping
	// template still accepts default-dynamic-mapped documents; a missing template or
	// an unreachable ES is logged and the loop proceeds regardless.
	if err := NewClient(esURL).EnsureTemplate(ctx); err != nil {
		log.Printf("marketplace-indexer: EnsureTemplate: %v (continuing)", err)
	}

	log.Printf("marketplace-indexer: starting, interval=%s es=%s", interval, esURL)

	runOnce := func() {
		tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		n, err := indexer.RunOnce(tctx)
		if err != nil {
			log.Printf("marketplace-indexer: RunOnce error: %v", err)
			return
		}
		if n > 0 {
			log.Printf("marketplace-indexer: processed %d outbox row(s)", n)
		}
	}

	runOnce()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Println("marketplace-indexer: shutting down")
			return
		case <-ticker.C:
			runOnce()
		}
	}
}
