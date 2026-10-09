package fractionalre

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/timeutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Handler is the investor-facing HTTP surface for the fractionalre module.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// errMap is the module's error→status table (see ADR-class convention in
// go-common/httperr). Ordering matters: the first matching rule wins.
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusBadRequest, ErrIdempotencyKey, ErrBeneficiaryInput, ErrValidation),
	httperr.R(http.StatusUnprocessableEntity, ErrLimitExceeded, ErrTicketRange,
		ErrBeneficiaryShare, ErrBeneficiaryLimit),
	httperr.R(http.StatusForbidden, ErrKYCRequired, ErrRiskAckRequired,
		ErrMasterRiskRequired, ErrProfileInactive),
	httperr.R(http.StatusConflict, ErrOfferingNotOpen, ErrMarketHalted,
		ErrInsufficientUnits, ErrInvalidTransition, ErrMakerChecker, ErrTitleSoD,
		ErrThresholdNotMet, ErrIdempotencyConflict, ErrOfferingSoldOut, ErrNoCapTable),
	httperr.R(http.StatusUnprocessableEntity, ErrAmountOverflow),
	httperr.R(http.StatusPaymentRequired, ledger.ErrInsufficientFunds),
)

// httpErr maps service errors to status codes. Insufficient-funds carries a
// fixed client-facing message rather than the sentinel's wording.
func httpErr(c *gin.Context, err error) {
	if errors.Is(err, ledger.ErrInsufficientFunds) {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		return
	}
	errMap.Write(c, err)
}

func (h *Handler) Activate(c *gin.Context) {
	p, err := h.svc.Activate(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Me(c *gin.Context) {
	p, err := h.svc.Me(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Suitability(c *gin.Context) {
	var body struct {
		Score   int             `json:"score"`
		Answers json.RawMessage `json:"answers"`
	}
	_ = c.ShouldBindJSON(&body)
	answers := []byte("{}")
	if len(body.Answers) > 0 {
		answers = body.Answers
	}
	if err := h.svc.SubmitSuitability(c.Request.Context(), ginutil.UserID(c), body.Score, answers); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) RiskAck(c *gin.Context) {
	var body struct {
		OfferingID      *string `json:"offering_id"`
		DisclosureRef   string  `json:"disclosure_ref"`
		ScrollCompleted bool    `json:"scroll_completed"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if !body.ScrollCompleted {
		c.JSON(http.StatusBadRequest, gin.H{"error": "risk disclosure must be fully scrolled before acknowledgement"})
		return
	}
	ack, err := h.svc.AckRisk(c.Request.Context(), ginutil.UserID(c), body.OfferingID, body.DisclosureRef, body.ScrollCompleted)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, ack)
}

func (h *Handler) ListOfferings(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 25, 200)
	out, err := h.svc.ListOfferings(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"offerings": out})
}

func (h *Handler) GetOffering(c *gin.Context) {
	o, err := h.svc.GetOffering(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *Handler) Watch(c *gin.Context) {
	if err := h.svc.AddWatch(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Unwatch(c *gin.Context) {
	if err := h.svc.RemoveWatch(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Watchlist(c *gin.Context) {
	out, err := h.svc.ListWatch(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"watchlist": out})
}

// LimitCheck exposes the compliance engine (also reused server-side in subscribe).
func (h *Handler) LimitCheck(c *gin.Context) {
	var body struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	_ = c.ShouldBindJSON(&body)
	chk, err := h.svc.LimitCheck(c.Request.Context(), ginutil.UserID(c), body.AmountKobo)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, chk)
}

func (h *Handler) Subscribe(c *gin.Context) {
	if ginutil.IdempotencyKey(c) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, ErrIdempotencyKey)})
		return
	}
	var req SubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	sub, err := h.svc.Subscribe(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), c.Param("id"), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, sub)
}

func (h *Handler) Portfolio(c *gin.Context) {
	holdings, err := h.svc.ListHoldings(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	var totalCost int64
	for _, hd := range holdings {
		totalCost += hd.CostKobo
	}
	c.JSON(http.StatusOK, gin.H{"holdings": holdings, "total_cost_kobo": totalCost, "count": len(holdings)})
}

func (h *Handler) Holdings(c *gin.Context) {
	out, err := h.svc.ListHoldings(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"holdings": out})
}

func (h *Handler) Holding(c *gin.Context) {
	// :id is a cap-table holding id → resolve via the user's holdings.
	out, err := h.svc.ListHoldings(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	id := c.Param("id")
	for _, hd := range out {
		if hd.ID == id {
			c.JSON(http.StatusOK, hd)
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "holding not found"})
}

func (h *Handler) Payouts(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 25, 200)
	out, err := h.svc.ListPayouts(c.Request.Context(), ginutil.UserID(c), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"payouts": out})
}

func (h *Handler) Statements(c *gin.Context) {
	// Statements are derived from payouts + holdings (read-only aggregate).
	payouts, _ := h.svc.ListPayouts(c.Request.Context(), ginutil.UserID(c), 200, 0)
	holdings, _ := h.svc.ListHoldings(c.Request.Context(), ginutil.UserID(c))
	c.JSON(http.StatusOK, gin.H{"holdings": holdings, "payouts": payouts})
}

func (h *Handler) ListAutoInvest(c *gin.Context) {
	out, err := h.svc.ListAutoInvest(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"auto_invest": out})
}

func (h *Handler) CreateAutoInvest(c *gin.Context) {
	var body struct {
		AmountKobo int64   `json:"amount_kobo" binding:"required"`
		Cadence    string  `json:"cadence"`
		AssetType  *string `json:"asset_type"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if body.Cadence == "" {
		body.Cadence = "monthly"
	}
	a, err := h.svc.CreateAutoInvest(c.Request.Context(), ginutil.UserID(c), body.AmountKobo, body.Cadence, body.AssetType)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) PauseAutoInvest(c *gin.Context) {
	if err := h.svc.PauseAutoInvest(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Market(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 25, 200)
	out, err := h.svc.ListActiveListings(c.Request.Context(), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"listings": out})
}

func (h *Handler) MarketList(c *gin.Context) {
	if ginutil.IdempotencyKey(c) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, ErrIdempotencyKey)})
		return
	}
	var req ListFractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	l, err := h.svc.ListFraction(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, l)
}

func (h *Handler) MarketBuy(c *gin.Context) {
	if ginutil.IdempotencyKey(c) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, ErrIdempotencyKey)})
		return
	}
	var req BuyFractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	o, err := h.svc.BuyFraction(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), c.Param("id"), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, o)
}

func (h *Handler) MarketOrders(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 25, 200)
	out, err := h.svc.ListOrdersForUser(c.Request.Context(), ginutil.UserID(c), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": out})
}

func (h *Handler) Documents(c *gin.Context) {
	out, err := h.svc.ListDocuments(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"documents": out})
}

func (h *Handler) Certificate(c *gin.Context) {
	d, err := h.svc.GetCertificate(c.Request.Context(), ginutil.UserID(c), c.Param("investmentId"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func (h *Handler) ListGoals(c *gin.Context) {
	out, err := h.svc.ListGoals(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"goals": out})
}

func (h *Handler) CreateGoal(c *gin.Context) {
	var body struct {
		Name       string `json:"name" binding:"required"`
		TargetKobo int64  `json:"target_kobo"`
		TargetDate string `json:"target_date"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	td := timeutil.ParseDatePtr(body.TargetDate)
	g, err := h.svc.CreateGoal(c.Request.Context(), ginutil.UserID(c), body.Name, body.TargetKobo, td)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, g)
}

// Referrals (work order 2): the platform referral engine already exists at
// internal/finance/referrals (per-user code + joined count + earned kobo,
// ledger-credited rewards). This is a THIN read proxy over that service —
// reused, never rebuilt. When the engine is not wired (nil dep / feature flag
// off) the endpoint returns a well-formed {enabled:false} payload that the
// mobile client renders as a "coming soon" state.
// Note: the platform engine records completed referrals only (a row exists
// once the referred user qualifies), so `invited` mirrors `joined` — there is
// no separate invite-tracking event upstream.

// ReferralSource is the subset of the platform referral engine the FRE surface
// reads. Satisfied by *referrals.Service.
type ReferralSource interface {
	GetSummary(ctx context.Context, userID string) (*referrals.Summary, error)
}

// WithReferrals wires the platform referral engine (optional; nil → disabled).
func (s *Service) WithReferrals(src ReferralSource) *Service { s.referrals = src; return s }

// ReferralSummary projects the platform engine's summary into the FRE payload.
func (s *Service) ReferralSummary(ctx context.Context, userID string) (*ReferralView, error) {
	if s.referrals == nil {
		return &ReferralView{Enabled: false}, nil
	}
	sum, err := s.referrals.GetSummary(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &ReferralView{
		Enabled:    true,
		Code:       sum.Code,
		Invited:    sum.TotalReferrals, // engine tracks completed referrals only
		Joined:     sum.TotalReferrals,
		EarnedKobo: sum.TotalEarnedKobo,
	}, nil
}

// Referrals handles GET /api/finance/fractionalre/referrals.
func (h *Handler) Referrals(c *gin.Context) {
	out, err := h.svc.ReferralSummary(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// Beneficiaries (work order 1). NOT a money path — no idempotency key — but all
// inputs are hard-validated (service + DB CHECKs) and every add/remove is
// audit-logged to fre_audit_log. The share-cap (sum <= 100%) and max-count
// rules are additionally enforced by a race-safe guarded INSERT in the repo.

// validateBeneficiaryInput is the pure input gate (unit-testable, no DB).
// Rules mirror the DB CHECKs: name 2..80, relationship 2..40, share 1..100.
func validateBeneficiaryInput(name, relationship string, sharePct int) error {
	name = strings.TrimSpace(name)
	relationship = strings.TrimSpace(relationship)
	if l := len([]rune(name)); l < 2 || l > 80 {
		return fmt.Errorf("%w: name must be 2-80 characters", ErrBeneficiaryInput)
	}
	if l := len([]rune(relationship)); l < 2 || l > 40 {
		return fmt.Errorf("%w: relationship must be 2-40 characters", ErrBeneficiaryInput)
	}
	if sharePct < 1 || sharePct > 100 {
		return fmt.Errorf("%w: share_pct must be between 1 and 100", ErrBeneficiaryInput)
	}
	return nil
}

// beneficiaryCapCheck is the pure server-side aggregate rule (unit-testable):
// the user's total share across beneficiaries must not exceed 100% and the
// count must stay under MaxBeneficiaries.
func beneficiaryCapCheck(existingTotalPct, existingCount, newSharePct int) error {
	if existingCount >= MaxBeneficiaries {
		return ErrBeneficiaryLimit
	}
	if existingTotalPct+newSharePct > 100 {
		return ErrBeneficiaryShare
	}
	return nil
}

func (s *Service) ListBeneficiaries(ctx context.Context, userID string) ([]Beneficiary, error) {
	return s.repo.ListBeneficiaries(ctx, userID)
}

// AddBeneficiary validates hard, applies the share-cap/count rules, and inserts
// via a guarded statement so a concurrent add can never overshoot 100%.
func (s *Service) AddBeneficiary(ctx context.Context, userID, name, relationship string, sharePct int) (*Beneficiary, error) {
	if err := validateBeneficiaryInput(name, relationship, sharePct); err != nil {
		return nil, err
	}
	totalPct, count, err := s.repo.SumBeneficiaryShares(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := beneficiaryCapCheck(totalPct, count, sharePct); err != nil {
		return nil, err
	}
	b := &Beneficiary{
		UserID:       userID,
		Name:         strings.TrimSpace(name),
		Relationship: strings.TrimSpace(relationship),
		SharePct:     sharePct,
	}
	if err := s.repo.InsertBeneficiary(ctx, b); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, userID, "beneficiary.add", "beneficiary", b.ID, "",
		nil, map[string]any{"name": b.Name, "relationship": b.Relationship, "share_pct": b.SharePct})
	return b, nil
}

// RemoveBeneficiary deletes the caller's own row only; a foreign or unknown id
// is a 404 (object-level authorization).
func (s *Service) RemoveBeneficiary(ctx context.Context, userID, id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return ErrNotFound
	}
	if err := s.repo.DeleteBeneficiary(ctx, id, userID); err != nil {
		return err
	}
	_ = s.audit.log(ctx, userID, "beneficiary.remove", "beneficiary", id, "", nil, nil)
	return nil
}

func (r *Repository) ListBeneficiaries(ctx context.Context, userID string) ([]Beneficiary, error) {
	const q = `SELECT id, user_id, name, relationship, share_pct, created_at
		FROM fre_beneficiaries WHERE user_id=$1 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Beneficiary
	for rows.Next() {
		var b Beneficiary
		if err := rows.Scan(&b.ID, &b.UserID, &b.Name, &b.Relationship, &b.SharePct, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SumBeneficiaryShares returns the user's current share total and row count.
func (r *Repository) SumBeneficiaryShares(ctx context.Context, userID string) (int, int, error) {
	var totalPct int
	var count int
	var err error

	const q = `SELECT COALESCE(SUM(share_pct),0), COUNT(*) FROM fre_beneficiaries WHERE user_id=$1`
	err = r.db.QueryRow(ctx, q, userID).Scan(&totalPct, &count)
	return totalPct, count, err
}

// InsertBeneficiary is a guarded insert: the WHERE re-checks the share cap and
// the max-count atomically, so two concurrent adds cannot jointly exceed 100%.
func (r *Repository) InsertBeneficiary(ctx context.Context, b *Beneficiary) error {
	const q = `
		INSERT INTO fre_beneficiaries (user_id, name, relationship, share_pct)
		SELECT $1, $2, $3, $4
		WHERE (SELECT COALESCE(SUM(share_pct),0) FROM fre_beneficiaries WHERE user_id=$1) + $4 <= 100
		  AND (SELECT COUNT(*) FROM fre_beneficiaries WHERE user_id=$1) < $5
		RETURNING id, created_at`
	err := r.db.QueryRow(ctx, q, b.UserID, b.Name, b.Relationship, b.SharePct, MaxBeneficiaries).
		Scan(&b.ID, &b.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost a race against a concurrent add — surface the aggregate rule.
		return ErrBeneficiaryShare
	}
	return err
}

// DeleteBeneficiary removes the row only when it belongs to userID.
func (r *Repository) DeleteBeneficiary(ctx context.Context, id, userID string) error {
	const q = `DELETE FROM fre_beneficiaries WHERE id=$1 AND user_id=$2`
	ct, err := r.db.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (h *Handler) ListBeneficiaries(c *gin.Context) {
	out, err := h.svc.ListBeneficiaries(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"beneficiaries": out})
}

func (h *Handler) AddBeneficiary(c *gin.Context) {
	var body struct {
		Name         string `json:"name" binding:"required"`
		Relationship string `json:"relationship" binding:"required"`
		SharePct     int    `json:"share_pct" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	b, err := h.svc.AddBeneficiary(c.Request.Context(), ginutil.UserID(c), body.Name, body.Relationship, body.SharePct)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

func (h *Handler) DeleteBeneficiary(c *gin.Context) {
	if err := h.svc.RemoveBeneficiary(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
