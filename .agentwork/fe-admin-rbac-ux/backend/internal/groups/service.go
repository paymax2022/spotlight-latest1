package groups

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
)

// Service manages groups, membership, and dues payments.
type Service struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
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
	// Create group ledger account.
	const insertAccount = `
		INSERT INTO ledger_accounts (user_id, type)
		VALUES (NULL, 'group_wallet')
		ON CONFLICT DO NOTHING`
	if _, err := tx.Exec(ctx, insertAccount); err != nil {
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
