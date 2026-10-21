package restaurant

// FOOD-UAT-F-003: admin-editable commission split. The food-delivery settlement
// split (restaurant / rider / platform) used to be the hard-coded 80/10/10 consts in
// service.go. ResolveCommissionSplit now reads it from restaurant_commission_config: a
// restaurant-specific row wins, else the global default row (restaurant_id IS NULL),
// else the built-in 80/10/10 so a deployment whose migration has not landed behaves
// exactly as before. Values are basis points and always sum to 10000.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	commissionCacheTTL = 30 * time.Second
	bpsTotal           = 10000
)

// CommissionSplit is a resolved restaurant/rider/platform split in basis points.
type CommissionSplit struct {
	ProviderBps int    `json:"provider_split_bps"`
	RiderBps    int    `json:"rider_split_bps"`
	PlatformBps int    `json:"platform_split_bps"`
	Source      string `json:"source"` // "restaurant" | "global" | "builtin"
}

// DefaultCommissionSplit is the legacy 80/10/10.
var DefaultCommissionSplit = CommissionSplit{ProviderBps: 8000, RiderBps: 1000, PlatformBps: 1000, Source: "builtin"}

// Valid reports whether the split is non-negative and sums to exactly 10000 bps.
func (c CommissionSplit) Valid() error {
	if c.ProviderBps < 0 || c.RiderBps < 0 || c.PlatformBps < 0 {
		return errors.New("split values must not be negative")
	}
	if c.ProviderBps+c.RiderBps+c.PlatformBps != bpsTotal {
		return fmt.Errorf("splits must sum to %d bps (got %d)", bpsTotal, c.ProviderBps+c.RiderBps+c.PlatformBps)
	}
	return nil
}

// The *Pct helpers feed settlement.Split. bps/10000 is a correctly rounded division,
// so 8000/10000 is bit-identical to the old 0.80 literal — the default path changes
// no kobo.
func (c CommissionSplit) ProviderPct() float64 { return float64(c.ProviderBps) / bpsTotal }
func (c CommissionSplit) RiderPct() float64    { return float64(c.RiderBps) / bpsTotal }
func (c CommissionSplit) PlatformPct() float64 { return float64(c.PlatformBps) / bpsTotal }

// ProviderPctNoRider folds the rider share into the provider (rider-less settle).
func (c CommissionSplit) ProviderPctNoRider() float64 {
	return float64(c.ProviderBps+c.RiderBps) / bpsTotal
}

type commissionCacheKey struct {
	db           *pgxpool.Pool
	restaurantID string
}

type commissionCacheEntry struct {
	split   CommissionSplit
	expires time.Time
}

var commissionCache sync.Map // commissionCacheKey -> commissionCacheEntry

// InvalidateCommissionCache drops every cached resolution for this service's pool so
// an admin write is visible immediately on this instance (other instances converge
// within commissionCacheTTL).
func (s *Service) InvalidateCommissionCache() {
	commissionCache.Range(func(k, _ any) bool {
		if ck, ok := k.(commissionCacheKey); ok && ck.db == s.db {
			commissionCache.Delete(k)
		}
		return true
	})
}

// ResolveCommissionSplit returns the split for a restaurant: its override if one is
// in effect, else the global default. Cached for 30s. It never returns an invalid
// split: any read error or malformed row falls back to the built-in 80/10/10 (the
// pre-existing behaviour) and is not cached.
func (s *Service) ResolveCommissionSplit(ctx context.Context, restaurantID string) CommissionSplit {
	key := commissionCacheKey{db: s.db, restaurantID: restaurantID}
	if v, ok := commissionCache.Load(key); ok {
		if e := v.(commissionCacheEntry); time.Now().Before(e.expires) {
			return e.split
		}
	}
	split, err := s.loadCommissionSplit(ctx, restaurantID)
	if err != nil {
		log.Printf("[restaurant] commission config unavailable for %q (%v) — using built-in 80/10/10", restaurantID, err)
		return DefaultCommissionSplit
	}
	commissionCache.Store(key, commissionCacheEntry{split: split, expires: time.Now().Add(commissionCacheTTL)})
	return split
}

func (s *Service) loadCommissionSplit(ctx context.Context, restaurantID string) (CommissionSplit, error) {
	if s.db == nil {
		return DefaultCommissionSplit, errors.New("no db")
	}
	// Restaurant row sorts before the global (NULL) row; the latest effective wins.
	var c CommissionSplit
	var rid *string
	err := s.db.QueryRow(ctx, `
		SELECT provider_split_bps, rider_split_bps, platform_split_bps, restaurant_id::text
		  FROM restaurant_commission_config
		 WHERE effective_from <= now()
		   AND (restaurant_id IS NULL OR restaurant_id::text = $1)
		 ORDER BY (restaurant_id IS NULL) ASC, effective_from DESC, created_at DESC
		 LIMIT 1`, restaurantID).Scan(&c.ProviderBps, &c.RiderBps, &c.PlatformBps, &rid)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultCommissionSplit, nil
	}
	if err != nil {
		return DefaultCommissionSplit, err
	}
	c.Source = "global"
	if rid != nil {
		c.Source = "restaurant"
	}
	if verr := c.Valid(); verr != nil {
		return DefaultCommissionSplit, verr
	}
	return c, nil
}
