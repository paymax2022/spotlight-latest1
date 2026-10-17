package transport

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Admin editor for transport_parcel_rate_card (one row per zone × size ×
// speed: a fare multiplier in basis points and a minimum fare in kobo). The
// transport service prices parcels from it behind FEATURE_PARCEL_RATE_CARD_ENABLED.
//
// An edit only changes the NEXT estimate. A card-checkout quote freezes the
// cell it priced from (parcelFrozenPricing.Rate), so nothing here can move the
// amount of an in-flight checkout — and this file must never write anywhere
// but the rate card and the audit log.

// Bounds mirror the table's CHECK constraints (multiplier_bps BETWEEN 1000 AND
// 100000, min_fare_kobo >= 0); the min-fare cap is an extra fat-finger guard
// the table does not have (₦1,000,000).
const (
	minParcelMultiplierBps int64 = 1000
	maxParcelMultiplierBps int64 = 100000
	maxParcelMinFareKobo   int64 = 100_000_000
	maxRateCardReasonLen         = 500
)

var (
	rateCardSizes  = []string{"small", "medium", "large"}
	rateCardSpeeds = []string{"standard", "express", "same_day", "scheduled"}
)

// ParcelRateCell is one rate-card row as the admin console sees it.
type ParcelRateCell struct {
	Zone          string    `json:"zone"`
	Size          string    `json:"size"`
	Speed         string    `json:"speed"`
	MultiplierBps int64     `json:"multiplierBps"`
	MinFareKobo   int64     `json:"minFareKobo"`
	Active        bool      `json:"active"`
	UpdatedBy     *string   `json:"updatedBy"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// ParcelRateCard is every stored cell for one zone.
type ParcelRateCard struct {
	Zone  string           `json:"zone"`
	Cells []ParcelRateCell `json:"cells"`
}

// ParcelRateCellPatch edits one cell. Nil fields are left unchanged; at least
// one must be set, and a reason is always required (it lands in the audit log).
type ParcelRateCellPatch struct {
	Zone          string `json:"zone"`
	MultiplierBps *int64 `json:"multiplier_bps"`
	MinFareKobo   *int64 `json:"min_fare_kobo"`
	Active        *bool  `json:"active"`
	Reason        string `json:"reason"`
}

// validateParcelRateCellPatch checks the edit and normalizes zone + reason in
// place. Every failure is a 400 raised before the database is touched.
func validateParcelRateCellPatch(size, speed string, req *ParcelRateCellPatch) error {
	bad := func(code, msg string) error { return codedErr(http.StatusBadRequest, code, msg) }
	if !slices.Contains(rateCardSizes, size) {
		return bad("INVALID_PARCEL_SIZE", "size must be small, medium or large")
	}
	if !slices.Contains(rateCardSpeeds, speed) {
		return bad("INVALID_PARCEL_SPEED", "speed must be standard, express, same_day or scheduled")
	}
	if req.MultiplierBps == nil && req.MinFareKobo == nil && req.Active == nil {
		return bad("NO_CHANGES", "set at least one of multiplier_bps, min_fare_kobo, active")
	}
	if m := req.MultiplierBps; m != nil && (*m < minParcelMultiplierBps || *m > maxParcelMultiplierBps) {
		return bad("INVALID_MULTIPLIER", "multiplier_bps must be between 1000 (0.1x) and 100000 (10x)")
	}
	if f := req.MinFareKobo; f != nil && (*f < 0 || *f > maxParcelMinFareKobo) {
		return bad("INVALID_MIN_FARE", "min_fare_kobo must be between 0 and 100000000 (₦1,000,000)")
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" {
		return bad("REASON_REQUIRED", "a reason is required for a rate-card change")
	}
	if len(req.Reason) > maxRateCardReasonLen {
		return bad("REASON_TOO_LONG", "reason must be at most 500 characters")
	}
	req.Zone = strings.TrimSpace(req.Zone)
	if req.Zone == "" {
		req.Zone = "default"
	}
	return nil
}

const parcelRateCellCols = `zone, size, speed, multiplier_bps, min_fare_kobo, active, updated_by::text, updated_at`

func scanParcelRateCell(row pgx.Row) (ParcelRateCell, error) {
	var c ParcelRateCell
	err := row.Scan(&c.Zone, &c.Size, &c.Speed, &c.MultiplierBps, &c.MinFareKobo, &c.Active, &c.UpdatedBy, &c.UpdatedAt)
	return c, err
}

// GetParcelRateCard returns every stored cell for zone (inactive included), in
// display order. No fallback to 'default': the editor shows what is stored.
func (a *AdminService) GetParcelRateCard(ctx context.Context, zone string) (*ParcelRateCard, error) {
	zone = strings.TrimSpace(zone)
	if zone == "" {
		zone = "default"
	}
	rows, err := a.svc.db.Query(ctx, `
		SELECT `+parcelRateCellCols+`
		FROM public.transport_parcel_rate_card
		WHERE zone = $1
		ORDER BY array_position($2::text[], size), array_position($3::text[], speed)`,
		zone, rateCardSizes, rateCardSpeeds)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	card := &ParcelRateCard{Zone: zone, Cells: []ParcelRateCell{}}
	for rows.Next() {
		c, err := scanParcelRateCell(rows)
		if err != nil {
			return nil, err
		}
		card.Cells = append(card.Cells, c)
	}
	return card, rows.Err()
}

// PatchParcelRateCell updates one existing cell and writes its audit row in
// the same transaction: the old cell is read FOR UPDATE, so the audited "old"
// is exactly what this edit replaced even under concurrent edits, and a failed
// audit insert rolls the change back. Pricing config, not money: there is no
// ledger posting, and nothing already quoted is repriced.
func (a *AdminService) PatchParcelRateCell(ctx context.Context, adminID, size, speed string, req ParcelRateCellPatch) (*ParcelRateCell, error) {
	if err := validateParcelRateCellPatch(size, speed, &req); err != nil {
		return nil, err
	}
	tx, err := a.svc.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	old, err := scanParcelRateCell(tx.QueryRow(ctx, `
		SELECT `+parcelRateCellCols+`
		FROM public.transport_parcel_rate_card
		WHERE zone=$1 AND size=$2 AND speed=$3
		FOR UPDATE`, req.Zone, size, speed))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "no rate-card cell for that zone, size and speed")
	}
	if err != nil {
		return nil, err
	}

	updated, err := scanParcelRateCell(tx.QueryRow(ctx, `
		UPDATE public.transport_parcel_rate_card SET
			multiplier_bps = COALESCE($4, multiplier_bps),
			min_fare_kobo  = COALESCE($5, min_fare_kobo),
			active         = COALESCE($6, active),
			updated_by     = NULLIF($7, '')::uuid,
			updated_at     = NOW()
		WHERE zone=$1 AND size=$2 AND speed=$3
		RETURNING `+parcelRateCellCols, req.Zone, size, speed, req.MultiplierBps, req.MinFareKobo, req.Active, adminID))
	if err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, adminID, "parcel_rate_card.update", "parcel_rate_card",
		req.Zone+":"+size+":"+speed, old, updated, req.Reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &updated, nil
}

// GetParcelRateCard returns the parcel rate card for ?zone= (default 'default').
func (h *AdminHandler) GetParcelRateCard(c *gin.Context) {
	card, err := h.svc.GetParcelRateCard(c.Request.Context(), c.Query("zone"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, card)
}

// PatchParcelRateCell updates one size × speed cell (audited, reason required).
func (h *AdminHandler) PatchParcelRateCell(c *gin.Context) {
	var req ParcelRateCellPatch
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	cell, err := h.svc.PatchParcelRateCell(c.Request.Context(), ginutil.UserID(c), c.Param("size"), c.Param("speed"), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, cell)
}
