package groups

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	keyError = "error"
)

// ErrTierGateUnwired is returned by PayDues when the Service was constructed
// without WithTiers — see the comment on that method for why this fails
// closed instead of treating a nil gate as "unlimited."
var ErrTierGateUnwired = errors.New("groups: money path requires a tier gate (WithTiers not wired)")

// ErrGroupNotFound is returned by Get when the group does not exist, the id is
// not a uuid, OR the caller is a non-member of a private group. The three cases
// deliberately share one sentinel: the groups_select RLS policy (migration
// 20260616230000) makes private groups invisible to non-members, and the pgx
// path bypasses RLS, so the service enforces the same rule — answering 404
// rather than 403 keeps a non-member from learning that a private group id
// exists at all.
var ErrGroupNotFound = errors.New("groups: group not found")

// ErrPlanNotFound is returned by PayDues when the plan id is unknown or belongs
// to a different group — a client error (404), not a server fault.
var ErrPlanNotFound = errors.New("groups: subscription plan not found")

// ErrIdempotencyKeyConflict is returned when a member's Idempotency-Key is
// already bound to a DIFFERENT dues operation (other group, plan or amount).
// Mapped to 409 at the handler — same contract as transfers and social.
var ErrIdempotencyKeyConflict = errors.New("groups: idempotency key already used by another dues payment")

// Auditor is the immutable-audit slice the groups money path needs — the same
// shape as social.Auditor (NL-12 / iron rule: every money mutation emits an
// audit event). nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

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
	audit  Auditor
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

// WithAuditor wires the immutable-audit sink into the dues money path. A nil
// argument is ignored so an unwired injection can never strip the sink —
// same convention as social's WithTiers.
func (s *Service) WithAuditor(a Auditor) *Service {
	if a != nil {
		s.audit = a
	}
	return s
}

// log emits a module-scoped audit event; nil-safe.
func (s *Service) log(actor, target, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "groups", resType, resID, oldV, newV, "", "", "info")
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
	defer func() { _ = tx.Rollback(ctx) }()

	const insert = `
		INSERT INTO groups (id, name, description, created_by, avatar_url, is_public)
		VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := tx.Exec(ctx, insert, g.ID, g.Name, g.Description, g.CreatedBy, g.AvatarURL, g.IsPublic); err != nil {
		return nil, fmt.Errorf("groups: insert: %w", err)
	}
	const insertMember = `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`
	if _, err := tx.Exec(ctx, insertMember, g.ID, creatorID); err != nil {
		return nil, fmt.Errorf("groups: insert owner: %w", err)
	}
	// The owner row above IS member #1 — reflect that in the create response so
	// it agrees with the member_count a subsequent GET computes (was 0).
	g.MemberCount = 1
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

// Get fetches a single group for a specific caller, enforcing the same
// visibility rule as the groups_select RLS policy the pgx pool bypasses:
// public groups are readable by any authenticated user; private groups only by
// members. Non-members and nonexistent ids both return ErrGroupNotFound so a
// caller cannot probe which private group ids exist (IDOR, prod sweep F-7.3).
func (s *Service) Get(ctx context.Context, id, userID string) (*Group, error) {
	// A malformed uuid can never name a group; saying "not found" up front also
	// keeps the driver error text off the wire.
	if _, err := uuid.Parse(id); err != nil {
		return nil, ErrGroupNotFound
	}
	const q = `
		SELECT g.id, g.name, g.description, g.created_by, g.avatar_url, g.is_public,
		       COUNT(gm.user_id), g.created_at,
		       EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $2)
		FROM groups g
		LEFT JOIN group_members gm ON gm.group_id = g.id
		WHERE g.id = $1
		GROUP BY g.id`
	g := &Group{}
	var isMember bool
	err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&g.ID, &g.Name, &g.Description, &g.CreatedBy, &g.AvatarURL, &g.IsPublic,
		&g.MemberCount, &g.CreatedAt, &isMember,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrGroupNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("groups: get: %w", err)
	}
	if !g.IsPublic && !isMember {
		return nil, ErrGroupNotFound
	}
	return g, nil
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
	var plan SubscriptionPlan
	const qPlan = `SELECT id, group_id, amount_kobo FROM subscription_plans WHERE id=$1 AND group_id=$2`
	if err := s.db.QueryRow(ctx, qPlan, req.PlanID, groupID).Scan(&plan.ID, &plan.GroupID, &plan.AmountKobo); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPlanNotFound
		}
		return nil, fmt.Errorf("groups: load plan: %w", err)
	}

	var groupWalletID string
	const qWallet = `SELECT id FROM ledger_accounts WHERE group_id=$1 AND type='group_wallet' LIMIT 1`
	if err := s.db.QueryRow(ctx, qWallet, groupID).Scan(&groupWalletID); err != nil {
		return nil, fmt.Errorf("groups: group wallet not found: %w", err)
	}

	// Member-scoped replay BEFORE the tier gate: a retry of the SAME member's
	// key returns the recorded payment — the lookup is scoped to the caller
	// (same convention as social's paymentByIdem), so another member's payment
	// under a reused key can never echo back as this member's. The gate runs
	// after it for the same reason transfers put walletPreflight after replay:
	// once money moved, re-running the gate can only refuse a request whose
	// debit already posted — and that error invites a fresh-key double-pay.
	// Lookup errors are returned, not swallowed (D7): a failed read must never
	// fall through to a second debit.
	p, err := s.paymentByIdem(ctx, memberID, req.IdempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("groups: pay dues replay lookup: %w", err)
	}
	if p != nil {
		// A same-key row for THIS member must carry the same material params
		// (D7): a different plan/amount/group under a reused key is a
		// 409-grade conflict, not a silent echo of the other payment.
		if p.GroupID == groupID && p.PlanID == req.PlanID && p.AmountKobo == plan.AmountKobo {
			return p, nil
		}
		return nil, ErrIdempotencyKeyConflict
	}

	ref := "dues:" + groupID + ":" + req.PlanID
	// Deploy-boundary convergence (525-D1): pre-namespacing builds posted the
	// dues debit under the RAW caller key (entry <K>:debit on the member
	// wallet — the SAME "dues:<group>:<plan>" reference the namespaced key
	// still carries; the journal is atomic, so the group-wallet credit
	// <K>:credit exists iff the debit does). A crash post-legs/pre-row on the
	// old build leaves that leg but no group_payments row; a namespaced-only
	// retry would debit AGAIN. Probe BEFORE the gate and converge: money
	// already moved, so no gate may refuse it.
	legacyAmt, legacyFound, err := s.memberEntryAmount(ctx, memberID, req.IdempotencyKey+":debit", ref)
	if err != nil {
		return nil, fmt.Errorf("groups: pay dues legacy probe: %w", err)
	}
	if legacyFound {
		if legacyAmt != plan.AmountKobo {
			return nil, ErrIdempotencyKeyConflict
		}
		p, err := s.recordDuesPayment(ctx, groupID, memberID, req.PlanID, plan.AmountKobo, req.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		s.log(memberID, "", "groups.dues.pay", "group_payment", p.ID, nil, map[string]any{"amount_kobo": plan.AmountKobo, "plan_id": req.PlanID, "converged": true})
		return p, nil
	}

	// Fail-closed tier / daily-limit gate (iron rule #4): a nil gate refuses all
	// dues rather than silently debiting unlimited (ErrTierGateUnwired).
	if s.tiers == nil {
		return nil, ErrTierGateUnwired
	}
	if err := s.tiers.EnforceCheckoutDebitLimit(ctx, memberID, plan.AmountKobo); err != nil {
		return nil, fmt.Errorf("groups: pay dues tier gate: %w", err)
	}

	// The ledger journal key is namespaced ("groups:dues:"): a caller key can
	// never be absorbed by a journal posted under another rail's purpose (S2).
	// DebitWithBalanceCheck's replay check compares only amount under the key,
	// so a raw caller key used on, say, a transfer with the same amount would
	// silently no-op the debit while the 'paid' row below recorded success.
	key := "groups:dues:" + req.IdempotencyKey
	if err := s.ledger.Debit(ctx, memberID, ref, key, groupWalletID, plan.AmountKobo); err != nil {
		return nil, fmt.Errorf("groups: pay dues debit: %w", err)
	}

	// Verify the debit leg actually posted on THIS member's wallet (S2):
	// compare account + key + amount, not merely key existence. A key
	// colliding with a same-amount journal on a DIFFERENT account satisfies
	// the ledger's replay check while posting nothing for this member —
	// recording 'paid' off that would be a phantom row.
	wallet, err := s.ledger.GetOrCreateUserWallet(ctx, memberID)
	if err != nil {
		return nil, fmt.Errorf("groups: pay dues wallet lookup: %w", err)
	}
	posted, ok, err := s.ledger.EntryAmount(ctx, wallet.ID, key+":debit")
	if err != nil {
		return nil, fmt.Errorf("groups: pay dues verify: %w", err)
	}
	if !ok || posted != plan.AmountKobo {
		return nil, ErrIdempotencyKeyConflict
	}

	p, err = s.recordDuesPayment(ctx, groupID, memberID, req.PlanID, plan.AmountKobo, req.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	s.log(memberID, "", "groups.dues.pay", "group_payment", p.ID, nil, map[string]any{"amount_kobo": plan.AmountKobo, "plan_id": req.PlanID})
	return p, nil
}

// recordDuesPayment inserts the group_payments row — the replay anchor — and
// resolves the ON CONFLICT winner member-scoped: a conflicting row owned by a
// different dues operation is ErrIdempotencyKeyConflict, not silent success.
func (s *Service) recordDuesPayment(ctx context.Context, groupID, memberID, planID string, amountKobo int64, idemKey string) (*SubscriptionPayment, error) {
	p := &SubscriptionPayment{
		ID:             uuid.New().String(),
		GroupID:        groupID,
		MemberID:       memberID,
		PlanID:         planID,
		AmountKobo:     amountKobo,
		Status:         "paid",
		PeriodStart:    time.Now(),
		PeriodEnd:      time.Now().AddDate(0, 1, 0),
		IdempotencyKey: idemKey,
		CreatedAt:      time.Now(),
	}
	const insertPayment = `
		INSERT INTO group_payments (id, group_id, member_id, plan_id, amount_kobo, status, period_start, period_end, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'paid',$6,$7,$8)
		ON CONFLICT (idempotency_key) DO NOTHING`
	ct, err := s.db.Exec(ctx, insertPayment, p.ID, p.GroupID, p.MemberID, p.PlanID, p.AmountKobo, p.PeriodStart, p.PeriodEnd, p.IdempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("groups: record dues payment: %w", err)
	}
	if ct.RowsAffected() == 0 {
		winner, err := s.paymentByIdem(ctx, memberID, idemKey)
		if err != nil {
			return nil, fmt.Errorf("groups: pay dues conflict lookup: %w", err)
		}
		if winner != nil && winner.GroupID == groupID && winner.PlanID == planID && winner.AmountKobo == amountKobo {
			return winner, nil
		}
		return nil, ErrIdempotencyKeyConflict
	}
	return p, nil
}

// memberEntryAmount returns the amount of the ledger entry carrying exactly
// this idempotency_key AND reference on memberID's user_wallet — the precise
// per-leg probe (account + key + ref) used for deploy-boundary residue: a raw
// caller key could otherwise match an entry posted by a DIFFERENT rail under
// the same key (pre-namespacing every rail used raw caller keys).
func (s *Service) memberEntryAmount(ctx context.Context, memberID, entryKey, reference string) (int64, bool, error) {
	var amt int64
	err := s.db.QueryRow(ctx, `SELECT e.amount_kobo FROM ledger_entries e
		JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet'
		  AND e.idempotency_key = $2 AND e.reference = $3`,
		memberID, entryKey, reference).Scan(&amt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("groups: member entry probe: %w", err)
	}
	return amt, true, nil
}

// paymentByIdem returns the dues payment recorded for THIS member under
// idemKey, or nil when none exists — the caller-scoped replay lookup (S2).
func (s *Service) paymentByIdem(ctx context.Context, memberID, idemKey string) (*SubscriptionPayment, error) {
	const q = `SELECT id, group_id, member_id, plan_id, amount_kobo, status, period_start, period_end, idempotency_key, created_at
	           FROM group_payments WHERE member_id=$1 AND idempotency_key=$2`
	var p SubscriptionPayment
	if err := s.db.QueryRow(ctx, q, memberID, idemKey).Scan(
		&p.ID, &p.GroupID, &p.MemberID, &p.PlanID, &p.AmountKobo, &p.Status,
		&p.PeriodStart, &p.PeriodEnd, &p.IdempotencyKey, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (s *Service) assertRole(ctx context.Context, groupID, userID string, allowed ...MemberRole) error {
	const q = `SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2`
	var role string
	if err := s.db.QueryRow(ctx, q, groupID, userID).Scan(&role); err != nil {
		return errors.New("groups: member not found")
	}
	if slices.Contains(allowed, MemberRole(role)) {
		return nil
	}
	return fmt.Errorf("groups: insufficient role — need %v, have %s", allowed, role)
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Create(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	g, err := h.svc.Create(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": groups})
}

func (h *Handler) Get(c *gin.Context) {
	g, err := h.svc.Get(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		if errors.Is(err, ErrGroupNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keyError: "group not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.Invite(c.Request.Context(), c.Param("id"), inviterID, body.UserID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) PayDues(c *gin.Context) {
	memberID := ginutil.UserID(c)
	var req PayDuesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	// The Idempotency-Key HEADER is the platform convention for money mutations
	// (ginutil.IdempotencyKey, also accepted verbatim through the BFF proxy);
	// the body's idempotency_key field stays supported for clients that already
	// send it there. The key remains required either way — iron rule #1.
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = ginutil.IdempotencyKey(c)
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key required"})
		return
	}
	payment, err := h.svc.PayDues(c.Request.Context(), c.Param("id"), memberID, req)
	if err != nil {
		c.JSON(payDuesErrMap.Code(err), gin.H{keyError: httperr.Msg(c, payDuesErrMap.Code(err), err)})
		return
	}
	c.JSON(http.StatusCreated, payment)
}

// payDuesErrMap maps PayDues' fail-closed tier-gate refusals to their HTTP
// status, mirroring restaurant's escrowErrStatus for the same errors.
var payDuesErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrPlanNotFound),
	httperr.R(http.StatusForbidden, tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded),
	httperr.R(http.StatusConflict, ErrIdempotencyKeyConflict),
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
// IdempotencyKey is intentionally NOT binding:"required": callers may supply it
// via the Idempotency-Key header instead (the platform convention), and the
// handler performs the presence check after the header fallback — see PayDues.
type PayDuesRequest struct {
	PlanID         string `json:"plan_id" binding:"required"`
	IdempotencyKey string `json:"idempotency_key"`
}
