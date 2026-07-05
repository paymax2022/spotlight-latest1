package fractionalre

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// AdminHandler is the admin control-plane HTTP surface. Every route is gated by
// RBAC at the router (RequirePermission); SoD invariants (maker!=checker,
// title.verifier!=creator) are additionally enforced in the service.
type AdminHandler struct {
	svc *Service
}

func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

func (h *AdminHandler) Dashboard(c *gin.Context) {
	assets, _ := h.svc.ListAssets(c.Request.Context(), "", 200, 0)
	offerings, _ := h.svc.ListOfferings(c.Request.Context(), "", 200, 0)
	c.JSON(http.StatusOK, gin.H{"asset_count": len(assets), "offering_count": len(offerings)})
}

// ── Sponsors ──────────────────────────────────────────────────────────────────

func (h *AdminHandler) ListSponsors(c *gin.Context) {
	out, err := h.svc.ListSponsors(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"sponsors": out})
}

func (h *AdminHandler) CreateSponsor(c *gin.Context) {
	var sp Sponsor
	if err := c.ShouldBindJSON(&sp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.CreateSponsor(c.Request.Context(), uid(c), &sp)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

// ── Assets ────────────────────────────────────────────────────────────────────

func (h *AdminHandler) ListAssets(c *gin.Context) {
	limit, offset := pageParams(c, 50)
	out, err := h.svc.ListAssets(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assets": out})
}

func (h *AdminHandler) CreateAsset(c *gin.Context) {
	var a Asset
	if err := c.ShouldBindJSON(&a); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.CreateAsset(c.Request.Context(), uid(c), &a)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *AdminHandler) GetAsset(c *gin.Context) {
	a, err := h.svc.GetAsset(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

func (h *AdminHandler) PatchAsset(c *gin.Context) {
	var body struct {
		NAVKobo     *int64  `json:"nav_kobo"`
		Description *string `json:"description"`
		Location    *string `json:"location"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PatchAsset(c.Request.Context(), uid(c), c.Param("id"), body.NAVKobo, body.Description, body.Location); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// TitleVerify is gated by fractionalre.title_verify; SoD (verifier != creator)
// is enforced in the service.
func (h *AdminHandler) TitleVerify(c *gin.Context) {
	var body struct {
		Clear bool   `json:"clear"`
		Ref   string `json:"ref"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.TitleVerify(c.Request.Context(), uid(c), c.Param("id"), body.Clear, body.Ref)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

func (h *AdminHandler) Transition(c *gin.Context) {
	var body struct {
		To string `json:"to" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.Transition(c.Request.Context(), uid(c), c.Param("id"), AssetStatus(body.To))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

func (h *AdminHandler) CapTable(c *gin.Context) {
	out, err := h.svc.GetCapTable(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cap_table": out})
}

func (h *AdminHandler) CapTableTransfer(c *gin.Context) {
	var body struct {
		AssetID  string `json:"asset_id" binding:"required"`
		FromUser string `json:"from_user" binding:"required"`
		ToUser   string `json:"to_user" binding:"required"`
		Units    int64  `json:"units" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.TransferCapTable(c.Request.Context(), uid(c), body.AssetID, body.FromUser, body.ToUser, body.Units); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Rounds / offerings ────────────────────────────────────────────────────────

func (h *AdminHandler) CreateRound(c *gin.Context) {
	var o Offering
	if err := c.ShouldBindJSON(&o); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	o.AssetID = c.Param("id")
	out, err := h.svc.CreateOffering(c.Request.Context(), uid(c), &o)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *AdminHandler) ListRounds(c *gin.Context) {
	limit, offset := pageParams(c, 50)
	out, err := h.svc.ListOfferings(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"rounds": out})
}

func (h *AdminHandler) GetRound(c *gin.Context) {
	o, err := h.svc.GetOffering(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *AdminHandler) OpenRound(c *gin.Context) {
	if err := h.svc.OpenOffering(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AdminHandler) ExtendRound(c *gin.Context) {
	var body struct {
		ExtraDays int `json:"extra_days" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	o, err := h.svc.ExtendOffering(c.Request.Context(), uid(c), c.Param("id"), body.ExtraDays)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

// CloseRound is the maker-checker close. A body flag `propose=true` records the
// maker's intent; otherwise the caller is the CHECKER and the round is settled
// (allocate or refund). SoD enforced in the service.
func (h *AdminHandler) CloseRound(c *gin.Context) {
	var body struct {
		Propose bool `json:"propose"`
	}
	_ = c.ShouldBindJSON(&body)
	ctx := c.Request.Context()
	if body.Propose {
		if err := h.svc.ProposeClose(ctx, uid(c), c.Param("id")); err != nil {
			httpErr(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "stage": "proposed"})
		return
	}
	o, err := h.svc.CloseAndSettle(ctx, uid(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *AdminHandler) RefundRound(c *gin.Context) {
	o, err := h.svc.RefundRound(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

// AllocateRound is an explicit allocation trigger (checker, threshold met).
func (h *AdminHandler) AllocateRound(c *gin.Context) {
	o, err := h.svc.CloseAndSettle(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

// FinanceRefund is the admin finance escape hatch keyed by roundId.
func (h *AdminHandler) FinanceRefund(c *gin.Context) {
	o, err := h.svc.RefundRound(c.Request.Context(), uid(c), c.Param("roundId"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

// ── Investors / compliance ────────────────────────────────────────────────────

func (h *AdminHandler) ListInvestors(c *gin.Context) {
	// Read from the audit/holdings surface — minimal list via holdings is out of
	// scope; return the requesting filter echo. Concrete listing is admin-only and
	// driven by the holdings/cap-table reads above.
	c.JSON(http.StatusOK, gin.H{"investors": []any{}})
}

func (h *AdminHandler) GetInvestor(c *gin.Context) {
	p, err := h.svc.repo.GetInvestorProfile(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *AdminHandler) InvestorLimit(c *gin.Context) {
	chk, err := h.svc.LimitCheck(c.Request.Context(), c.Param("id"), 0)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, chk)
}

func (h *AdminHandler) LimitOverride(c *gin.Context) {
	var body struct {
		OverrideKobo int64  `json:"override_kobo" binding:"required"`
		Reason       string `json:"reason" binding:"required"`
		ReasonCode   string `json:"reason_code"` // hni_upgrade|vip_waiver|error_correction|compliance_review|other (default other)
		ExpiresAt    string `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var exp *time.Time
	if body.ExpiresAt != "" {
		if t, err := time.Parse(time.RFC3339, body.ExpiresAt); err == nil {
			exp = &t
		}
	}
	if err := h.svc.OverrideLimit(c.Request.Context(), uid(c), c.Param("id"), body.OverrideKobo, body.Reason, body.ReasonCode, exp); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AdminHandler) Classify(c *gin.Context) {
	var body struct {
		Classification string `json:"classification" binding:"required"`
		IncomeKobo     int64  `json:"declared_annual_income_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ClassifyInvestor(c.Request.Context(), uid(c), c.Param("id"), Classification(body.Classification), body.IncomeKobo); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AdminHandler) KYCQueue(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"queue": []any{}})
}

func (h *AdminHandler) KYCDecision(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true, "user_id": c.Param("userId")})
}

func (h *AdminHandler) ComplianceDashboard(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Distributions (maker-checker) ─────────────────────────────────────────────

func (h *AdminHandler) ScheduleDistribution(c *gin.Context) {
	if idemKey(c) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": ErrIdempotencyKey.Error()})
		return
	}
	var req ScheduleDistributionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.ScheduleDistribution(c.Request.Context(), uid(c), idemKey(c), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *AdminHandler) ListDistributions(c *gin.Context) {
	limit, offset := pageParams(c, 50)
	out, err := h.svc.ListDistributions(c.Request.Context(), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"distributions": out})
}

func (h *AdminHandler) PreviewDistribution(c *gin.Context) {
	d, lines, err := h.svc.PreviewDistribution(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"distribution": d, "lines": lines})
}

func (h *AdminHandler) SubmitDistribution(c *gin.Context) {
	d, err := h.svc.SubmitDistribution(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// ApproveDistribution is gated by fractionalre.distribution_approve; the
// maker!=checker SoD invariant is enforced in the service.
func (h *AdminHandler) ApproveDistribution(c *gin.Context) {
	d, err := h.svc.ApproveDistribution(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// ── Secondary market (admin) ──────────────────────────────────────────────────

func (h *AdminHandler) ListMarketListings(c *gin.Context) {
	limit, offset := pageParams(c, 50)
	out, err := h.svc.ListActiveListings(c.Request.Context(), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"listings": out})
}

func (h *AdminHandler) HaltListing(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.HaltListing(c.Request.Context(), uid(c), c.Param("id"), body.Reason); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AdminHandler) MarketControls(c *gin.Context) {
	var body struct {
		TradingEnabled bool `json:"trading_enabled"`
		FeeBps         int  `json:"fee_bps"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateMarketControls(c.Request.Context(), uid(c), body.TradingEnabled, body.FeeBps); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Finance ───────────────────────────────────────────────────────────────────

func (h *AdminHandler) Escrow(c *gin.Context) {
	bal, err := h.svc.EscrowBalance(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"escrow_balance_kobo": bal})
}

func (h *AdminHandler) Fees(c *gin.Context) {
	mc, err := h.svc.GetMarketControls(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"secondary_fee_bps": mc.FeeBps})
}

// ── Documents ─────────────────────────────────────────────────────────────────

func (h *AdminHandler) Documents(c *gin.Context) {
	out, err := h.svc.ListDocuments(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"documents": out})
}

func (h *AdminHandler) PresignDocument(c *gin.Context) {
	var body struct {
		AssetID     string `json:"asset_id"`
		DocType     string `json:"doc_type" binding:"required"`
		ContentType string `json:"content_type"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.ContentType == "" {
		body.ContentType = "application/pdf"
	}
	url, key, err := h.svc.PresignDocument(c.Request.Context(), uid(c), body.AssetID, body.DocType, body.ContentType)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"upload_url": url, "object_key": key})
}

// ── Audit ─────────────────────────────────────────────────────────────────────

func (h *AdminHandler) Audit(c *gin.Context) {
	limit, offset := pageParams(c, 100)
	out, err := h.svc.ListAudit(c.Request.Context(), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"audit": out})
}
