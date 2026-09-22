package connectgifting

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// CONNECT-001 (P0 blocker) — admin gifting read surface.
//
// Register() (handlers.go) only ever wired the MEMBER group (/gifts,
// /gifts/sent, /gifts/catalog). There was no admin registration at all, so
// the admin "Gift transactions ledger" page (frontend-admin/app/admin/connect/
// gifting/page.tsx, via connectAdminService.ts listGifts() -> GET
// /api/connect/admin/gifts) 404'd in production. This file adds that route.
//
// This is a REPORTING surface only: it reads connect_gifts (+ a join into
// connect_gift_catalog for a human label) and never mutates money. No new
// debit/credit logic is introduced here.
//
// Known, deliberate data-shape gaps (see full explanation on AdminGiftTransaction
// below) — the admin UI's TypeScript type (frontend-admin/src/types/connectAdmin.ts
// GiftTransaction) asks for three fields the current schema cannot honestly
// supply as historical fact: fee_kobo, tier_at_send, limit_state. Rather than
// inventing numbers, each is filled with the most defensible REAL value
// available and clearly documented — never a fabricated one.
// ---------------------------------------------------------------------------

// AdminGiftTransaction is the admin ledger-view shape returned by
// GET /api/connect/admin/gifts. Field names/JSON keys match
// frontend-admin/src/types/connectAdmin.ts GiftTransaction exactly.
type AdminGiftTransaction struct {
	ID          string `json:"id"`
	Reference   string `json:"reference"` // the gift's ledger_ref — the real reconciliation key
	SenderID    string `json:"sender_id"`
	RecipientID string `json:"recipient_id"`
	GiftLabel   string `json:"gift_label"`
	AmountKobo  int64  `json:"amount_kobo"`
	// FeeKobo is always 0: connectgifting.Service.Send never applies a fee —
	// the full amount is transferred sender->recipient. This is a true
	// constant of the current implementation, not a placeholder.
	FeeKobo int64 `json:"fee_kobo"`
	// TierAtSend is the sender's CURRENT KYC tier (from finance/tiers), looked
	// up at READ time — NOT a historical snapshot. connect_gifts has no column
	// recording the tier that was in effect when the gift was sent, so an
	// honest historical value cannot be produced without a schema change. Left
	// nil (omitted) when no TierReader is wired.
	TierAtSend *int `json:"tier_at_send,omitempty"`
	// LimitState is always "within": Service.Send calls
	// TierGuard.EnforceWalletDebitLimit fail-closed BEFORE the transfer is
	// posted, so no row in connect_gifts could ever exist unless the sender's
	// daily-debit limit check passed at send time. This is a real, derived
	// fact, not a guess — every settled gift is "within" by construction, and
	// no "near_limit"/"blocked" gift can exist in this table (a blocked
	// attempt errors out of Service.Send before InsertGift runs).
	LimitState string    `json:"limit_state"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

// AdminGiftFilter mirrors the query params the admin UI sends
// (frontend-admin listGifts opts: status, limit_state).
type AdminGiftFilter struct {
	Status     string // admin vocabulary: successful|pending|reversed|failed|"" (all)
	LimitState string // admin vocabulary: within|near_limit|blocked|"" (all)
	Limit      int
}

// TierReader resolves a user's CURRENT KYC tier for admin reporting context.
// Implemented by an adapter over internal/finance/tiers.Service. Read-only —
// it never touches money movement. Optional: a nil TierReader simply omits
// tier_at_send from the response.
type TierReader interface {
	GetUserTier(ctx context.Context, userID string) (int, error)
}

// adminStatusToDB maps the admin UI's status vocabulary to the real
// connect_gifts.status CHECK constraint values ('sent','reversed'). The admin
// vocabulary's "pending" and "failed" have no backing rows: a gift row is
// only ever inserted AFTER a successful, settled wallet transfer (see
// Service.Send) — a failed attempt never reaches InsertGift, and there is no
// pending/async settlement step. Callers filtering on those statuses
// correctly get an empty result, not an error.
func adminStatusToDB(status string) (dbStatus string, hasRows bool) {
	switch status {
	case "":
		return "", true
	case "successful":
		return "sent", true
	case "reversed":
		return "reversed", true
	case "pending", "failed":
		return "", false
	default:
		return "", false
	}
}

func dbStatusToAdmin(status string) string {
	if status == "sent" {
		return "successful"
	}
	return status // "reversed" already matches
}

// ListAdmin returns the admin gift-transaction ledger view, applying the same
// filters the admin UI sends. It is a pure read path.
func (s *Service) ListAdmin(ctx context.Context, filter AdminGiftFilter) ([]AdminGiftTransaction, error) {
	// limit_state is always "within" for every real row (see LimitState doc
	// above) — any other requested value can only ever match zero rows, so
	// short-circuit rather than run a query that would just come back empty.
	if filter.LimitState != "" && filter.LimitState != "within" {
		return []AdminGiftTransaction{}, nil
	}
	dbStatus, hasRows := adminStatusToDB(filter.Status)
	if !hasRows {
		return []AdminGiftTransaction{}, nil
	}

	rows, err := s.repo.ListAdminGifts(ctx, dbStatus, filter.Limit)
	if err != nil {
		return nil, err
	}

	tierCache := map[string]*int{}
	out := make([]AdminGiftTransaction, 0, len(rows))
	for _, row := range rows {
		label := "Custom gift"
		if row.GiftName != nil && *row.GiftName != "" {
			label = *row.GiftName
		} else if row.GiftCode != nil && *row.GiftCode != "" {
			label = *row.GiftCode
		}

		var tierAtSend *int
		if s.tierReader != nil {
			if cached, ok := tierCache[row.SenderID]; ok {
				tierAtSend = cached
			} else {
				if t, terr := s.tierReader.GetUserTier(ctx, row.SenderID); terr == nil {
					v := t
					tierAtSend = &v
				}
				tierCache[row.SenderID] = tierAtSend
			}
		}

		out = append(out, AdminGiftTransaction{
			ID:          row.ID,
			Reference:   row.LedgerRef,
			SenderID:    row.SenderID,
			RecipientID: row.RecipientID,
			GiftLabel:   label,
			AmountKobo:  row.AmountKobo,
			FeeKobo:     0,
			TierAtSend:  tierAtSend,
			LimitState:  "within",
			Status:      dbStatusToAdmin(row.Status),
			CreatedAt:   row.CreatedAt,
		})
	}
	return out, nil
}

// AdminHandler exposes the admin gifting read surface over HTTP.
type AdminHandler struct{ svc *Service }

// NewAdminHandler builds an admin gifting handler.
func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

// ListGifts — GET /api/connect/admin/gifts (connect.gifting.view).
// Query params: status, limit_state (both optional, admin vocabulary), limit.
func (h *AdminHandler) ListGifts(c *gin.Context) {
	filter := AdminGiftFilter{
		Status:     c.Query("status"),
		LimitState: c.Query("limit_state"),
		Limit:      parseLimit(c),
	}
	out, err := h.svc.ListAdmin(c.Request.Context(), filter)
	if err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("list admin gifts: %v", err)})
		return
	}
	c.JSON(200, gin.H{"data": out})
}

// PermissionGuard mirrors middleware.RequirePermission without importing the
// middleware/services packages into this leaf package (same pattern as
// connect/aml.PermissionGuard) — the route file supplies a factory that
// builds the per-permission gin.HandlerFunc from the real RBAC service.
type PermissionGuard func(permission string) gin.HandlerFunc

// RegisterAdmin wires the admin gifting routes onto the connect admin group.
// The caller passes a guard factory (built from middleware.RequirePermission
// + the RBAC service), matching the connect/aml.Register pattern.
func RegisterAdmin(admin gin.IRouter, svc *Service, guard PermissionGuard) {
	h := NewAdminHandler(svc)
	admin.GET("/gifts", guard("connect.gifting.view"), h.ListGifts)
}
