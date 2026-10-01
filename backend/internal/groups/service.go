package groups

import (
	"context"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"strconv"
	"time"
)

// ErrTierGateUnwired is returned by PayDues when the Service was constructed
// without WithTiers — see the comment on that method for why this fails
// closed instead of treating a nil gate as "unlimited."
var ErrTierGateUnwired = errors.New("groups: money path requires a tier gate (WithTiers not wired)")

// tierLimiter is the minimal seam the dues money-path depends on for the
// fail-closed KYC-tier / daily-spend gate. *tiers.Service satisfies it in
// production; not imported directly here to avoid a package-cycle risk and to
// keep the surface this package depends on small and testable.
type tierLimiter interface {
	EnforceCheckoutDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// Service manages groups, membership, and dues payments.
type Service struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
	tiers  tierLimiter
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
}

// WithTiers wires the fail-closed KYC-tier / daily-spend gate into PayDues.
// A Service with no tier gate refuses every dues payment with
// ErrTierGateUnwired rather than silently debiting with no limit — see
// restaurant/transport's identical convention for the same reasoning.
func (s *Service) WithTiers(t tierLimiter) *Service {
	s.tiers = t
	return s
}

// Create creates a new group and its ledger wallet account.
func (s *Service) Create(ctx context.Context, creatorID string, req CreateGroupRequest) (*Group, error) {
	g := &Group{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		CreatedBy:   creatorID,
		AvatarURL:   req.AvatarURL,
		IsPublic:    req.IsPublic,
		CreatedAt:   time.Now(),
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("groups: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insert = `
		INSERT INTO groups (id, name, description, created_by, avatar_url, is_public)
		VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := tx.Exec(ctx, insert, g.ID, g.Name, g.Description, g.CreatedBy, g.AvatarURL, g.IsPublic); err != nil {
		return nil, fmt.Errorf("groups: insert: %w", err)
	}
	// Add creator as owner.
	const insertMember = `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`
	if _, err := tx.Exec(ctx, insertMember, g.ID, creatorID); err != nil {
		return nil, fmt.Errorf("groups: insert owner: %w", err)
	}
	// Create group ledger account, keyed to this group. Without group_id set,
	// the account is orphaned — PayDues looks it up by group_id and would never
	// find it, leaving every group's wallet permanently unreachable.
	const insertAccount = `
		INSERT INTO ledger_accounts (user_id, group_id, type)
		VALUES (NULL, $1, 'group_wallet')
		ON CONFLICT DO NOTHING`
	if _, err := tx.Exec(ctx, insertAccount, g.ID); err != nil {
		return nil, fmt.Errorf("groups: create ledger account: %w", err)
	}

	return g, tx.Commit(ctx)
}

// Get fetches a single group.
func (s *Service) Get(ctx context.Context, id string) (*Group, error) {
	const q = `
		SELECT g.id, g.name, g.description, g.created_by, g.avatar_url, g.is_public,
		       COUNT(gm.user_id), g.created_at
		FROM groups g
		LEFT JOIN group_members gm ON gm.group_id = g.id
		WHERE g.id = $1
		GROUP BY g.id`
	g := &Group{}
	return g, s.db.QueryRow(ctx, q, id).Scan(
		&g.ID, &g.Name, &g.Description, &g.CreatedBy, &g.AvatarURL, &g.IsPublic,
		&g.MemberCount, &g.CreatedAt,
	)
}

// List returns groups a user belongs to.
func (s *Service) List(ctx context.Context, userID string, limit, offset int) ([]Group, error) {
	const q = `
		SELECT g.id, g.name, g.description, g.created_by, g.avatar_url, g.is_public,
		       COUNT(gm2.user_id) AS member_count, g.created_at
		FROM groups g
		JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
		LEFT JOIN group_members gm2 ON gm2.group_id = g.id
		GROUP BY g.id
		ORDER BY g.created_at DESC LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Group
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.CreatedBy, &g.AvatarURL, &g.IsPublic, &g.MemberCount, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Invite adds a user to a group (only owner/admin can invite).
func (s *Service) Invite(ctx context.Context, groupID, inviterID, inviteeID string) error {
	// Verify inviter is owner or admin.
	if err := s.assertRole(ctx, groupID, inviterID, RoleOwner, RoleAdmin); err != nil {
		return err
	}
	const insert = `
		INSERT INTO group_members (group_id, user_id, role)
		VALUES ($1, $2, 'member')
		ON CONFLICT (group_id, user_id) DO NOTHING`
	_, err := s.db.Exec(ctx, insert, groupID, inviteeID)
	return err
}

// PayDues debits a member's wallet and credits the group wallet.
func (s *Service) PayDues(ctx context.Context, groupID, memberID string, req PayDuesRequest) (*SubscriptionPayment, error) {
	// Fetch plan.
	var plan SubscriptionPlan
	const qPlan = `SELECT id, group_id, amount_kobo FROM subscription_plans WHERE id=$1 AND group_id=$2`
	if err := s.db.QueryRow(ctx, qPlan, req.PlanID, groupID).Scan(&plan.ID, &plan.GroupID, &plan.AmountKobo); err != nil {
		return nil, fmt.Errorf("groups: plan not found: %w", err)
	}

	// Get group wallet ledger account.
	var groupWalletID string
	const qWallet = `SELECT id FROM ledger_accounts WHERE group_id=$1 AND type='group_wallet' LIMIT 1`
	if err := s.db.QueryRow(ctx, qWallet, groupID).Scan(&groupWalletID); err != nil {
		return nil, fmt.Errorf("groups: group wallet not found: %w", err)
	}

	// Fail-closed tier / daily-limit gate, matching restaurant/transport: dues are
	// a wallet debit like any other and owe CLAUDE.md's iron rule #4 a tier check
	// before the money moves. A nil gate is refused rather than treated as
	// unlimited (ErrTierGateUnwired) — a deployment with no gate must not accept
	// dues payments at all.
	if s.tiers == nil {
		return nil, ErrTierGateUnwired
	}
	if err := s.tiers.EnforceCheckoutDebitLimit(ctx, memberID, plan.AmountKobo); err != nil {
		return nil, fmt.Errorf("groups: pay dues tier gate: %w", err)
	}

	ref := "dues:" + groupID + ":" + req.PlanID
	if err := s.ledger.Debit(ctx, memberID, ref, req.IdempotencyKey, groupWalletID, plan.AmountKobo); err != nil {
		return nil, fmt.Errorf("groups: pay dues debit: %w", err)
	}

	p := &SubscriptionPayment{
		ID:             uuid.New().String(),
		GroupID:        groupID,
		MemberID:       memberID,
		PlanID:         req.PlanID,
		AmountKobo:     plan.AmountKobo,
		Status:         "paid",
		PeriodStart:    time.Now(),
		PeriodEnd:      time.Now().AddDate(0, 1, 0),
		IdempotencyKey: req.IdempotencyKey,
		CreatedAt:      time.Now(),
	}
	const insertPayment = `
		INSERT INTO group_payments (id, group_id, member_id, plan_id, amount_kobo, status, period_start, period_end, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'paid',$6,$7,$8)`
	_, err := s.db.Exec(ctx, insertPayment, p.ID, p.GroupID, p.MemberID, p.PlanID, p.AmountKobo, p.PeriodStart, p.PeriodEnd, p.IdempotencyKey)
	return p, err
}

func (s *Service) assertRole(ctx context.Context, groupID, userID string, allowed ...MemberRole) error {
	const q = `SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2`
	var role string
	if err := s.db.QueryRow(ctx, q, groupID, userID).Scan(&role); err != nil {
		return fmt.Errorf("groups: member not found")
	}
	for _, r := range allowed {
		if MemberRole(role) == r {
			return nil
		}
	}
	return fmt.Errorf("groups: insufficient role — need %v, have %s", allowed, role)
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Create(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.Create(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, g)
}

func (h *Handler) List(c *gin.Context) {
	userID := ginutil.UserID(c)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	groups, err := h.svc.List(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": groups})
}

func (h *Handler) Get(c *gin.Context) {
	g, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
		return
	}
	c.JSON(http.StatusOK, g)
}

func (h *Handler) Invite(c *gin.Context) {
	inviterID := ginutil.UserID(c)
	var body struct {
		UserID string `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Invite(c.Request.Context(), c.Param("id"), inviterID, body.UserID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) PayDues(c *gin.Context) {
	memberID := ginutil.UserID(c)
	var req PayDuesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	payment, err := h.svc.PayDues(c.Request.Context(), c.Param("id"), memberID, req)
	if err != nil {
		c.JSON(payDuesErrMap.Code(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, payment)
}

// payDuesErrMap maps PayDues' fail-closed tier-gate refusals to their HTTP
// status, mirroring restaurant's escrowErrStatus for the same errors.
var payDuesErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusForbidden, tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded),
	httperr.R(http.StatusServiceUnavailable, ErrTierGateUnwired),
)

// Group is the core entity — a community with its own wallet and subscription plan.
type Group struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedBy   string    `json:"created_by"`
	AvatarURL   *string   `json:"avatar_url,omitempty"`
	IsPublic    bool      `json:"is_public"`
	MemberCount int       `json:"member_count"`
	CreatedAt   time.Time `json:"created_at"`
}

// MemberRole is a member's role within the group.
type MemberRole string

const (
	RoleOwner  MemberRole = "owner"
	RoleAdmin  MemberRole = "admin"
	RoleMember MemberRole = "member"
)

// Member is a user's membership in a group.
type Member struct {
	ID       string     `json:"id"`
	GroupID  string     `json:"group_id"`
	UserID   string     `json:"user_id"`
	Role     MemberRole `json:"role"`
	JoinedAt time.Time  `json:"joined_at"`
}

// SubscriptionPlan is the dues configuration for a group.
type SubscriptionPlan struct {
	ID         string    `json:"id"`
	GroupID    string    `json:"group_id"`
	Name       string    `json:"name"`
	AmountKobo int64     `json:"amount_kobo"`
	Frequency  string    `json:"frequency"` // monthly | quarterly | annually | one_time
	DueDay     int       `json:"due_day"`   // day of month dues are due
	CreatedAt  time.Time `json:"created_at"`
}

// SubscriptionPayment is one member's dues payment.
type SubscriptionPayment struct {
	ID             string    `json:"id"`
	GroupID        string    `json:"group_id"`
	MemberID       string    `json:"member_id"`
	PlanID         string    `json:"plan_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Status         string    `json:"status"` // paid | pending | overdue
	PeriodStart    time.Time `json:"period_start"`
	PeriodEnd      time.Time `json:"period_end"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// CreateGroupRequest is the body for POST /groups.
type CreateGroupRequest struct {
	Name        string  `json:"name" binding:"required,min=2,max=100"`
	Description string  `json:"description"`
	IsPublic    bool    `json:"is_public"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
}

// PayDuesRequest is the body for POST /groups/:id/dues.
type PayDuesRequest struct {
	PlanID         string `json:"plan_id" binding:"required"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}
