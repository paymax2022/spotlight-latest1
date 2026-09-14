package savings

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Handler exposes the savings member API. user_id is mirrored onto the gin
// context by the finance group (c.Set("user_id", ...)), matching the wallet
// handler convention. Every mutating endpoint enforces object-level authZ in the
// service layer (owner/member checks) and requires an Idempotency-Key for money.
type Handler struct {
	vaults  *VaultService
	ajo     *AjoService
	targets *TargetService
}

func NewHandler(v *VaultService, a *AjoService, t *TargetService) *Handler {
	return &Handler{vaults: v, ajo: a, targets: t}
}

func userID(c *gin.Context) string { return c.GetString("user_id") }

func idemKey(c *gin.Context) string {
	return strings.TrimSpace(c.GetHeader("Idempotency-Key"))
}

func requireIdem(c *gin.Context) (string, bool) {
	k := idemKey(c)
	if k == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Idempotency-Key required"})
		return "", false
	}
	return k, true
}

func httpErr(c *gin.Context, err error) {
	switch err {
	case ErrForbidden:
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
	case ErrNotFound:
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
	case ErrLockedVault, ErrInsufficientVault, ErrReleaseRuleUnmet:
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": err.Error()})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
	}
}

// ───────────────────────── Vaults ─────────────────────────

func (h *Handler) CreateVault(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var req struct {
		Name       string     `json:"name"`
		Kind       string     `json:"kind"`
		TargetKobo int64      `json:"target_kobo"`
		MaturesAt  *time.Time `json:"matures_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	v, err := h.vaults.CreateVault(c.Request.Context(), uid, req.Name, VaultKind(strings.ToUpper(req.Kind)), req.TargetKobo, req.MaturesAt)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "vault": v})
}

func (h *Handler) ListVaults(c *gin.Context) {
	v, err := h.vaults.ListVaults(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "vaults": v})
}

func (h *Handler) VaultBalance(c *gin.Context) {
	// Object-scoped: BalanceForOwner refuses a vault the caller does not own.
	// Calling the bare Balance() here let any authenticated user read any
	// vault's balance by id.
	bal, err := h.vaults.BalanceForOwner(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) DepositVault(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	var req struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bal, err := h.vaults.Deposit(c.Request.Context(), userID(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) WithdrawVault(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	var req struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bal, err := h.vaults.Withdraw(c.Request.Context(), userID(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) EnableAutoSave(c *gin.Context) {
	var req struct {
		AmountKobo   int64 `json:"amount_kobo"`
		IntervalSecs int64 `json:"interval_secs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	jobID, err := h.vaults.EnableAutoSave(c.Request.Context(), userID(c), c.Param("id"), req.AmountKobo, req.IntervalSecs)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "job_id": jobID})
}

// ───────────────────────── Ajo / Esusu ─────────────────────────

func (h *Handler) CreateCircle(c *gin.Context) {
	var req struct {
		Name             string `json:"name"`
		ContributionKobo int64  `json:"contribution_kobo"`
		IntervalSecs     int64  `json:"interval_secs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	circle, err := h.ajo.CreateCircle(c.Request.Context(), userID(c), req.Name, req.ContributionKobo, req.IntervalSecs)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "circle": circle})
}

func (h *Handler) JoinCircle(c *gin.Context) {
	m, err := h.ajo.Join(c.Request.Context(), c.Param("id"), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "member": m})
}

func (h *Handler) ActivateCircle(c *gin.Context) {
	if err := h.ajo.Activate(c.Request.Context(), userID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) GetCircle(c *gin.Context) {
	uid := userID(c)
	circleID := c.Param("id")
	// Object-level authZ: only members may view circle detail.
	isMem, err := h.ajo.IsMember(c.Request.Context(), circleID, uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	if !isMem {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "not a member"})
		return
	}
	circle, members, err := h.ajo.GetCircle(c.Request.Context(), circleID)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circle": circle, "members": members})
}

func (h *Handler) MakeGood(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	var req struct {
		CycleNumber int `json:"cycle_number"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	if err := h.ajo.MakeGood(c.Request.Context(), c.Param("id"), userID(c), req.CycleNumber, key); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ───────────────────────── Group Target ─────────────────────────

func (h *Handler) CreateTarget(c *gin.Context) {
	var req struct {
		Name       string     `json:"name"`
		TargetKobo int64      `json:"target_kobo"`
		Rule       string     `json:"withdrawal_rule"`
		TargetDate *time.Time `json:"target_date"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	t, err := h.targets.Create(c.Request.Context(), userID(c), req.Name, req.TargetKobo, WithdrawalRule(strings.ToUpper(req.Rule)), req.TargetDate)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "target": t})
}

func (h *Handler) JoinTarget(c *gin.Context) {
	if err := h.targets.Join(c.Request.Context(), c.Param("id"), userID(c)); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) ContributeTarget(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	var req struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bal, err := h.targets.Contribute(c.Request.Context(), c.Param("id"), userID(c), req.AmountKobo, key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) ApproveTarget(c *gin.Context) {
	if err := h.targets.Approve(c.Request.Context(), c.Param("id"), userID(c)); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) ReleaseTarget(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	if err := h.targets.Release(c.Request.Context(), userID(c), c.Param("id"), key); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) TargetBalance(c *gin.Context) {
	// Object-scoped: membership is required to read a pot's balance.
	bal, err := h.targets.BalanceForMember(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

// ───────────────────────── Additive member reads (go-live gap) ─────────────────────────

// Summary is the savings dashboard aggregate for the caller.
func (h *Handler) Summary(c *gin.Context) {
	sum, err := h.vaults.BuildSummary(c.Request.Context(), userID(c), h.ajo, h.targets)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "summary": sum})
}

// GetVault returns a single owned vault with its derived balance.
func (h *Handler) GetVault(c *gin.Context) {
	v, bal, err := h.vaults.GetVault(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "vault": v, "balance_kobo": bal})
}

// EarlyWithdrawVault breaks a lock vault before maturity applying a penalty (bps).
// EarlyWithdrawQuote tells the member what breaking a lock will cost BEFORE
// they confirm. Now that the rate is server-side, this is the only honest way
// for a client to show the fee — without it the app would display one number
// and the server would charge another. Read-only: no ledger entries, no
// Idempotency-Key.
func (h *Handler) EarlyWithdrawQuote(c *gin.Context) {
	amount, err := strconv.ParseInt(c.Query("amount_kobo"), 10, 64)
	if err != nil || amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "amount_kobo must be a positive integer"})
		return
	}
	v, bal, err := h.vaults.GetVault(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	penalty := h.vaults.PenaltyQuote(v, amount)
	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"balance_kobo": bal,
		"amount_kobo":  amount,
		"penalty_bps":  h.vaults.EarlyBreakPenaltyBps(),
		"penalty_kobo": penalty,
		"net_kobo":     amount - penalty,
	})
}

func (h *Handler) EarlyWithdrawVault(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	// penalty_bps is NO LONGER read from the body. It was the fee rate, so any
	// member could break a LOCK vault free by sending 0. A client that still
	// sends the field is accepted and the value ignored (older builds always
	// sent it) — the rate now comes from service policy. Use the quote endpoint
	// to learn what a break will cost before confirming.
	var req struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bal, penalty, err := h.vaults.EarlyWithdraw(c.Request.Context(), userID(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal, "penalty_kobo": penalty})
}

// ListCircles returns the caller's Ajo circles.
func (h *Handler) ListCircles(c *gin.Context) {
	circles, err := h.ajo.ListCircles(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circles": circles})
}

// DiscoverCircles returns public FORMING circles the caller can join (not
// already a member of). Read-only; no PII/balance exposure.
func (h *Handler) DiscoverCircles(c *gin.Context) {
	circles, err := h.ajo.DiscoverCircles(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circles": circles})
}

// ContributeCircle lets a member prepay the current cycle's contribution.
func (h *Handler) ContributeCircle(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	if err := h.ajo.Contribute(c.Request.Context(), c.Param("id"), userID(c), key); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ListTargets returns the caller's group targets with derived balances.
func (h *Handler) ListTargets(c *gin.Context) {
	targets, err := h.targets.ListTargets(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "targets": targets})
}

// GetTarget returns a group target detail. Object-level authZ: members only.
func (h *Handler) GetTarget(c *gin.Context) {
	uid := userID(c)
	targetID := c.Param("id")
	isMem, err := h.targets.IsTargetMember(c.Request.Context(), targetID, uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	if !isMem {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "not a member"})
		return
	}
	t, members, bal, err := h.targets.GetTargetDetail(c.Request.Context(), targetID)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "target": t, "members": members, "balance_kobo": bal})
}

// Register mounts savings member routes on the finance group and admin routes on
// the savings admin group (per-route RBAC savings.admin.*). The aggregator
// (top5_p1_routes.go) wires the guard; this keeps handler<->route co-located.
func (h *Handler) Register(member *gin.RouterGroup, admin *gin.RouterGroup, guard func(string) gin.HandlerFunc) {
	g := member.Group("/savings")
	// Dashboard summary
	g.GET("/summary", h.Summary)
	// Vaults
	g.POST("/vaults", h.CreateVault)
	g.GET("/vaults", h.ListVaults)
	g.GET("/vaults/:id", h.GetVault)
	g.GET("/vaults/:id/balance", h.VaultBalance)
	g.POST("/vaults/:id/deposit", h.DepositVault)
	g.POST("/vaults/:id/withdraw", h.WithdrawVault)
	g.POST("/vaults/:id/early-withdraw", h.EarlyWithdrawVault)
	g.GET("/vaults/:id/early-withdraw/quote", h.EarlyWithdrawQuote)
	g.POST("/vaults/:id/autosave", h.EnableAutoSave)
	// Ajo / Esusu
	g.GET("/circles", h.ListCircles)
	g.GET("/circles/discover", h.DiscoverCircles)
	g.POST("/circles", h.CreateCircle)
	g.POST("/circles/:id/join", h.JoinCircle)
	g.POST("/circles/:id/activate", h.ActivateCircle)
	g.GET("/circles/:id", h.GetCircle)
	g.POST("/circles/:id/contribute", h.ContributeCircle)
	g.POST("/circles/:id/make-good", h.MakeGood)
	// Group target
	g.GET("/targets", h.ListTargets)
	g.POST("/targets", h.CreateTarget)
	g.GET("/targets/:id", h.GetTarget)
	g.POST("/targets/:id/join", h.JoinTarget)
	g.POST("/targets/:id/contribute", h.ContributeTarget)
	g.POST("/targets/:id/approve", h.ApproveTarget)
	g.POST("/targets/:id/release", h.ReleaseTarget)
	g.GET("/targets/:id/balance", h.TargetBalance)

	// Admin (ops): read-only oversight gated by savings.admin.*
	if admin != nil && guard != nil {
		admin.GET("/circles/:id", guard("savings.admin.view"), h.GetCircle)
	}
}
