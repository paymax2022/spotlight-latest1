package savings

import (
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/tiers"
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

// errMap carries the sentinel→status mapping shared by every savings handler;
// WriteOK preserves the {"success": false, "error": ...} envelope.
// Tier refusals map to 403 — the same status the canonical transfer rail's
// errMap gives them; ErrTierGateUnwired is a 503 (service degraded, never a
// silent pass).
var errMap = httperr.New(http.StatusBadRequest,
	httperr.R(http.StatusForbidden, ErrForbidden, tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded),
	httperr.R(http.StatusServiceUnavailable, ErrTierGateUnwired),
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusConflict, ErrLockedVault, ErrInsufficientVault, ErrReleaseRuleUnmet),
)

func (h *Handler) CreateVault(c *gin.Context) {
	uid := ginutil.UserID(c)
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
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "vault": v})
}

func (h *Handler) ListVaults(c *gin.Context) {
	v, err := h.vaults.ListVaults(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "vaults": v})
}

func (h *Handler) VaultBalance(c *gin.Context) {
	// Object-scoped: BalanceForOwner refuses a vault the caller does not own.
	// Calling the bare Balance() here let any authenticated user read any
	// vault's balance by id.
	bal, err := h.vaults.BalanceForOwner(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) DepositVault(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
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
	bal, err := h.vaults.Deposit(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) WithdrawVault(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
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
	bal, err := h.vaults.Withdraw(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		errMap.WriteOK(c, err)
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
	jobID, err := h.vaults.EnableAutoSave(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req.AmountKobo, req.IntervalSecs)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "job_id": jobID})
}

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
	circle, err := h.ajo.CreateCircle(c.Request.Context(), ginutil.UserID(c), req.Name, req.ContributionKobo, req.IntervalSecs)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "circle": circle})
}

func (h *Handler) JoinCircle(c *gin.Context) {
	m, err := h.ajo.Join(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "member": m})
}

func (h *Handler) ActivateCircle(c *gin.Context) {
	if err := h.ajo.Activate(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) GetCircle(c *gin.Context) {
	uid := ginutil.UserID(c)
	circleID := c.Param("id")
	// Object-level authZ: only members may view circle detail — and the denial
	// is the SAME ErrNotFound a nonexistent circle id returns (a distinct 403
	// "not a member" would confirm the circle exists to any authenticated
	// caller: membership rosters are financial data, not a public directory).
	// The member oracle stays closed; ops oversight lives on the dedicated
	// admin routes behind savings.admin.view.
	isMem, err := h.ajo.IsMember(c.Request.Context(), circleID, uid)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	if !isMem {
		errMap.WriteOK(c, ErrNotFound)
		return
	}
	circle, members, err := h.ajo.GetCircle(c.Request.Context(), circleID)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circle": circle, "members": members})
}

// AdminGetCircle serves the ops oversight read on the savings admin group. The
// RBAC guard (savings.admin.view) is the authZ, so the service read is
// deliberately NOT member-scoped — an ops admin who is not a circle member can
// still inspect the circle, the full member roster (all states) and the
// per-cycle contribution/payout state. (Mounting the member GetCircle here
// denied the admin exactly like an outsider — the residual this restores.)
// NEVER mount this handler on a member route: the member oracle stays closed.
func (h *Handler) AdminGetCircle(c *gin.Context) {
	circle, members, cycles, err := h.ajo.GetCircleOversight(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circle": circle, "members": members, "cycles": cycles})
}

// AdminGetCircleMembers is the roster twin of AdminGetCircle — the RBAC guard
// (savings.admin.view) is the authZ, so ops sees the FULL member roster (every
// state, incl. EXITED/DEFAULTED) without needing membership in the circle.
// NEVER mount on a member route: member reads stay member-scoped.
func (h *Handler) AdminGetCircleMembers(c *gin.Context) {
	members, err := h.ajo.GetCircleMembersOversight(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "members": members})
}

func (h *Handler) MakeGood(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
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
	if err := h.ajo.MakeGood(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req.CycleNumber, key); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

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
	t, err := h.targets.Create(c.Request.Context(), ginutil.UserID(c), req.Name, req.TargetKobo, WithdrawalRule(strings.ToUpper(req.Rule)), req.TargetDate)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "target": t})
}

func (h *Handler) JoinTarget(c *gin.Context) {
	if err := h.targets.Join(c.Request.Context(), c.Param("id"), ginutil.UserID(c)); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) ContributeTarget(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
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
	bal, err := h.targets.Contribute(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req.AmountKobo, key)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) ApproveTarget(c *gin.Context) {
	if err := h.targets.Approve(c.Request.Context(), c.Param("id"), ginutil.UserID(c)); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) ReleaseTarget(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	if err := h.targets.Release(c.Request.Context(), ginutil.UserID(c), c.Param("id"), key); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) TargetBalance(c *gin.Context) {
	// Object-scoped: membership is required to read a pot's balance.
	bal, err := h.targets.BalanceForMember(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

// Summary is the savings dashboard aggregate for the caller.
func (h *Handler) Summary(c *gin.Context) {
	sum, err := h.vaults.BuildSummary(c.Request.Context(), ginutil.UserID(c), h.ajo, h.targets)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "summary": sum})
}

// GetVault returns a single owned vault with its derived balance.
func (h *Handler) GetVault(c *gin.Context) {
	v, bal, err := h.vaults.GetVault(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
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
	v, bal, err := h.vaults.GetVault(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
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
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
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
	bal, penalty, err := h.vaults.EarlyWithdraw(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal, "penalty_kobo": penalty})
}

// ListCircles returns the caller's Ajo circles.
func (h *Handler) ListCircles(c *gin.Context) {
	circles, err := h.ajo.ListCircles(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circles": circles})
}

// DiscoverCircles returns public FORMING circles the caller can join (not
// already a member of). Read-only; no PII/balance exposure.
func (h *Handler) DiscoverCircles(c *gin.Context) {
	circles, err := h.ajo.DiscoverCircles(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "circles": circles})
}

// ContributeCircle lets a member prepay the current cycle's contribution.
func (h *Handler) ContributeCircle(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	if err := h.ajo.Contribute(c.Request.Context(), c.Param("id"), ginutil.UserID(c), key); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ListTargets returns the caller's group targets with derived balances.
func (h *Handler) ListTargets(c *gin.Context) {
	targets, err := h.targets.ListTargets(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "targets": targets})
}

// GetTarget returns a group target detail. Object-level authZ: members only.
func (h *Handler) GetTarget(c *gin.Context) {
	uid := ginutil.UserID(c)
	targetID := c.Param("id")
	isMem, err := h.targets.IsTargetMember(c.Request.Context(), targetID, uid)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	if !isMem {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "not a member"})
		return
	}
	t, members, bal, err := h.targets.GetTargetDetail(c.Request.Context(), targetID)
	if err != nil {
		errMap.WriteOK(c, err)
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

	// Admin (ops): read-only oversight gated by savings.admin.*. Oversight reads
	// use dedicated admin handlers, NOT the member ones — the member GetCircle
	// is member-scoped (uniform denial for a caller with no membership), which
	// would refuse an ops admin who is not a member and defeat the oversight
	// the RBAC grant is for.
	if admin != nil && guard != nil {
		admin.GET("/circles/:id", guard("savings.admin.view"), h.AdminGetCircle)
		admin.GET("/circles/:id/members", guard("savings.admin.view"), h.AdminGetCircleMembers)
	}
}

// VAULT — a wallet sub-balance held as a dedicated append-only ledger
// (savings_vault_ledger). Balance is ALWAYS derived (NL-8). Lock/Flex config is
// versioned (config-driven variation). NL-2: vaults earn ZERO yield.
// State machine: OPEN → (LOCKED|FLEX implied by config) → MATURED | CLOSED.

type VaultState string

const (
	VaultOpen    VaultState = "OPEN"
	VaultMatured VaultState = "MATURED"
	VaultClosed  VaultState = "CLOSED"
)

type VaultKind string

const (
	VaultFlex VaultKind = "FLEX" // withdraw anytime
	VaultLock VaultKind = "LOCK" // locked until maturity; early break guarded
)

var vaultTransitions = map[VaultState]map[VaultState]bool{
	VaultOpen:    {VaultMatured: true, VaultClosed: true},
	VaultMatured: {VaultClosed: true},
	VaultClosed:  {},
}

type Vault struct {
	ID            string     `json:"id"`
	OwnerUserID   string     `json:"owner_user_id"`
	Name          string     `json:"name"`
	Kind          VaultKind  `json:"kind"`
	State         VaultState `json:"state"`
	TargetKobo    int64      `json:"target_kobo"`    // optional goal
	ConfigVersion int        `json:"config_version"` // versioned lock/flex config
	MaturesAt     *time.Time `json:"matures_at,omitempty"`
	AutoSaveJobID *string    `json:"autosave_job_id,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`

	// BalanceKobo is the ledger-derived balance (SUM of savings_vault_ledger),
	// never a stored column — NL-8. It is populated by the READ paths that
	// project it (ListVaults, GetVault) and is 0 on a freshly created vault,
	// which is its true balance. NO omitempty: a real zero balance must
	// serialise, or a funded-then-emptied vault would be indistinguishable
	// from one whose balance was never projected.
	BalanceKobo int64 `json:"balance_kobo"`
}

// AJO / ESUSU CIRCLE — peer rotation savings. NL-7: members fund EACH OTHER;
// Paymax is ledger + escrow only, never guarantor / never advances capital
// (NL-1). NL-2: no yield. Each cycle every active member auto-debits the
// contribution; the pooled total pays out to the scheduled recipient for that
// cycle, then the rotation order advances.
// Circle: FORMING → ACTIVE → (CYCLE×n) → COMPLETED.
// Member:  INVITED → ACTIVE → DEFAULTED | EXITED.

type CircleState string

const (
	CircleForming   CircleState = "FORMING"
	CircleActive    CircleState = "ACTIVE"
	CircleCompleted CircleState = "COMPLETED"
	CircleCancelled CircleState = "CANCELLED"
)

var circleTransitions = map[CircleState]map[CircleState]bool{
	CircleForming:   {CircleActive: true, CircleCancelled: true},
	CircleActive:    {CircleCompleted: true, CircleCancelled: true},
	CircleCompleted: {},
	CircleCancelled: {},
}

type MemberState string

const (
	MemberInvited   MemberState = "INVITED"
	MemberActive    MemberState = "ACTIVE"
	MemberDefaulted MemberState = "DEFAULTED"
	MemberExited    MemberState = "EXITED"
)

var memberTransitions = map[MemberState]map[MemberState]bool{
	MemberInvited:   {MemberActive: true, MemberExited: true},
	MemberActive:    {MemberDefaulted: true, MemberExited: true},
	MemberDefaulted: {MemberActive: true, MemberExited: true}, // make-good restores
	MemberExited:    {},
}

type Circle struct {
	ID               string      `json:"id"`
	CreatorUserID    string      `json:"creator_user_id"`
	Name             string      `json:"name"`
	ContributionKobo int64       `json:"contribution_kobo"` // per member per cycle
	IntervalSecs     int64       `json:"interval_secs"`     // cycle cadence
	State            CircleState `json:"state"`
	CurrentCycle     int         `json:"current_cycle"`
	TotalCycles      int         `json:"total_cycles"` // == active member count at activation
	CycleJobID       *string     `json:"cycle_job_id,omitempty"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
}

type CircleMember struct {
	ID            string      `json:"id"`
	CircleID      string      `json:"circle_id"`
	UserID        string      `json:"user_id"`
	RotationOrder int         `json:"rotation_order"` // 0-based payout position
	State         MemberState `json:"state"`
	MissedCount   int         `json:"missed_count"`
	JoinedAt      time.Time   `json:"joined_at"`
}

type CycleStatus string

const (
	CyclePending CycleStatus = "PENDING"
	CycleRunning CycleStatus = "RUNNING"
	CyclePaid    CycleStatus = "PAID"
)

type Cycle struct {
	ID            string      `json:"id"`
	CircleID      string      `json:"circle_id"`
	CycleNumber   int         `json:"cycle_number"`
	RecipientID   string      `json:"recipient_id"`
	CollectedKobo int64       `json:"collected_kobo"`
	PayoutKobo    int64       `json:"payout_kobo"`
	Status        CycleStatus `json:"status"`
	ScheduledFor  time.Time   `json:"scheduled_for"`
	PaidAt        *time.Time  `json:"paid_at,omitempty"`
}

// GROUP TARGET — a shared goal pot. Balance is ledger-derived (NL-8). NL-2: no
// yield. Withdrawal rule is config: ON_DATE (after target_date) or MAJORITY
// (member approval threshold).

type TargetState string

const (
	TargetOpen     TargetState = "OPEN"
	TargetReached  TargetState = "REACHED"
	TargetReleased TargetState = "RELEASED"
	TargetClosed   TargetState = "CLOSED"
)

var targetTransitions = map[TargetState]map[TargetState]bool{
	TargetOpen:     {TargetReached: true, TargetReleased: true, TargetClosed: true},
	TargetReached:  {TargetReleased: true, TargetClosed: true},
	TargetReleased: {TargetClosed: true},
	TargetClosed:   {},
}

type WithdrawalRule string

const (
	RuleOnDate   WithdrawalRule = "ON_DATE"
	RuleMajority WithdrawalRule = "MAJORITY"
)

type GroupTarget struct {
	ID            string         `json:"id"`
	CreatorUserID string         `json:"creator_user_id"`
	Name          string         `json:"name"`
	TargetKobo    int64          `json:"target_kobo"`
	Rule          WithdrawalRule `json:"withdrawal_rule"`
	TargetDate    *time.Time     `json:"target_date,omitempty"`
	State         TargetState    `json:"state"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

type GroupTargetMember struct {
	ID       string    `json:"id"`
	TargetID string    `json:"target_id"`
	UserID   string    `json:"user_id"`
	Approved bool      `json:"approved"` // for MAJORITY release vote
	JoinedAt time.Time `json:"joined_at"`
}

func canVault(from, to VaultState) bool   { return vaultTransitions[from][to] }
func canCircle(from, to CircleState) bool { return circleTransitions[from][to] }
func canMember(from, to MemberState) bool { return memberTransitions[from][to] }
func canTarget(from, to TargetState) bool { return targetTransitions[from][to] }
