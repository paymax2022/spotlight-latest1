package groups

import "time"

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
