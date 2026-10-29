package provider

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// Earnings — GET /provider/earnings → ProviderEarnings. READ-ONLY, integer kobo.
//
// It is a view over vet_appointment_payments, which the escrow rail drives; this
// package never posts a ledger entry:
//
//	availableKobo  payments RELEASED to the vet — credited to their Paymax wallet
//	               at consult completion (escrow release, HL-9)
//	pendingKobo    HELD, appointment still awaiting acceptance (REQUESTED/ACCEPTED)
//	heldKobo       HELD, visit confirmed or in service (CONFIRMED/IN_PROGRESS)
//
// The ledger stays the source of truth for balances; this is oversight data.
func (h *Handler) Earnings(c *gin.Context) {
	_, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	var out wireEarnings
	const q = `
		SELECT
		  COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state = 'RELEASED'), 0),
		  COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state = 'HELD'
		            AND a.state IN ('REQUESTED','ACCEPTED')), 0),
		  COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state = 'HELD'
		            AND a.state IN ('CONFIRMED','IN_PROGRESS','RESCHEDULED')), 0)
		FROM vet_appointment_payments vp
		JOIN health_appointments a ON a.id = vp.appointment_id
		WHERE vp.provider_id = $1`
	if err := h.db.QueryRow(c.Request.Context(), q, p.ID).Scan(&out.AvailableKobo, &out.PendingKobo, &out.HeldKobo); err != nil {
		fail(c, http.StatusInternalServerError, "could not load your earnings")
		return
	}
	// Withdrawals are bank transfers from the wallet, recorded by the wallet
	// module — there is no vet-specific payout ledger to list.
	out.Payouts = []wirePayout{}
	c.JSON(http.StatusOK, out)
}

// RequestPayout — POST /provider/payouts. Deliberately not a money route.
//
// A vet's earnings are already credited to their Paymax wallet when the escrow is
// released, so a "payout" is an ordinary wallet withdrawal, which has its own
// idempotent, KYC- and tier-gated, ledger-posting path. Re-implementing that here
// would be a second, unaudited way to move money, so this answers with a clear
// conflict that tells the vet where to withdraw. The Idempotency-Key is still
// required so the contract stays honest for when a vet-specific payout is wired.
func (h *Handler) RequestPayout(c *gin.Context) {
	if _, _, ok := h.requireVet(c, true); !ok {
		return
	}
	if ginutil.IdempotencyKey(c) == "" {
		fail(c, http.StatusBadRequest, "Idempotency-Key required")
		return
	}
	c.JSON(http.StatusConflict, gin.H{
		"success": false,
		"code":    "payout_via_wallet",
		"error":   "Your earnings are paid into your Paymax wallet when a visit completes. Withdraw them from Wallet → Bank transfer.",
	})
}

// Reviews — GET /provider/reviews → VetReview[] (the owner shown as "First L.").
func (h *Handler) Reviews(c *gin.Context) {
	_, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	const q = `
		SELECT r.id::text, COALESCE(up.full_name, ''), r.rating, r.body, r.created_at
		FROM vet_reviews r LEFT JOIN user_profiles up ON up.id = r.owner_id
		WHERE r.provider_id = $1 AND NOT r.is_hidden
		ORDER BY r.created_at DESC LIMIT 100`
	rows, err := h.db.Query(c.Request.Context(), q, p.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not load your reviews")
		return
	}
	defer rows.Close()
	out := make([]wireReview, 0)
	for rows.Next() {
		var r wireReview
		var name string
		var at time.Time
		if err := rows.Scan(&r.ID, &name, &r.Rating, &r.Body, &at); err != nil {
			fail(c, http.StatusInternalServerError, "could not read your reviews")
			return
		}
		r.Author = shortName(name, "Pet owner")
		r.At = rfc3339(at)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		fail(c, http.StatusInternalServerError, "could not read your reviews")
		return
	}
	c.JSON(http.StatusOK, out)
}
