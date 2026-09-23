package connectvoting

import (
	"errors"
	"time"
)

// ─── Contest promotion (parent/child contest hierarchy) ─────────────────────
//
// A contest can be the "parent"/"mother" of independent "child" contests (a
// partner org runs its own local contest that feeds into a regional/national
// one — arbitrary depth). After a child contest's results are published and
// locked, an admin may REQUEST that its top-N ranked contestants be promoted
// into the parent contest. A SECOND, different admin must APPROVE the request
// (maker-checker, mirroring contest_admin_approvals' existing
// vote_adjustment/results_publish pattern) before a new contestant row is
// actually created under the parent contest.
//
// Money handling is N/A here — no monetary amounts are involved.

// ContestPartner mirrors a row of public.contest_partners — an external
// organisation (e.g. "Golibe") that runs a child contest.
type ContestPartner struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	ContactEmail *string    `json:"contact_email,omitempty"`
	ContactPhone *string    `json:"contact_phone,omitempty"`
	LogoURL      *string    `json:"logo_url,omitempty"`
	Notes        *string    `json:"notes,omitempty"`
	CreatedBy    *string    `json:"created_by,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// ChildContest is a summary row of public.contests filtered by
// parent_contest_id — enough for an admin list view without over-fetching the
// full legacy contest shape.
type ChildContest struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Status      string  `json:"status"`
	State       *string `json:"state,omitempty"`
	LGA         *string `json:"lga,omitempty"`
	PartnerID   *string `json:"partner_id,omitempty"`
}

// ContestHierarchyInfo is the minimal contests-row projection RequestPromotion
// needs to validate a promotion: the contest's own parent link (to detect a
// contest promoting into something that is itself a descendant — belt and
// braces on top of the DB cycle trigger) and its default top-N.
type ContestHierarchyInfo struct {
	ID                  string
	ParentContestID     *string
	DefaultPromoteTopN  *int
}

// RankedChildResult is one ranked row from the child contest's latest
// published voting_round_results.
type RankedChildResult struct {
	ContestantID string
	Rank         int
}

// ContestPromotion mirrors a row of public.contest_promotions — one row per
// contestant proposed/promoted from a child contest into its parent.
type ContestPromotion struct {
	ID               string     `json:"id"`
	ChildContestID   string     `json:"child_contest_id"`
	ParentContestID  string     `json:"parent_contest_id"`
	ContestantID     string     `json:"contestant_id"`
	RankInChild      int        `json:"rank_in_child"`
	RequestedBy      string     `json:"requested_by"`
	RequestedAt      time.Time  `json:"requested_at"`
	ApprovedBy       *string    `json:"approved_by,omitempty"`
	ApprovedAt       *time.Time `json:"approved_at,omitempty"`
	Status           string     `json:"status"`
	NewContestantID  *string    `json:"new_contestant_id,omitempty"`
	RejectionReason  *string    `json:"rejection_reason,omitempty"`
}

// --- Request DTOs ---

// CreatePartnerRequest is the body for POST /contest-partners.
type CreatePartnerRequest struct {
	Name         string `json:"name" binding:"required"`
	ContactEmail string `json:"contactEmail"`
	ContactPhone string `json:"contactPhone"`
	LogoURL      string `json:"logoUrl"`
	Notes        string `json:"notes"`
}

// UpdatePartnerRequest is the body for PATCH /contest-partners/:id. All
// fields optional — nil pointer means "leave unchanged".
type UpdatePartnerRequest struct {
	Name         *string `json:"name"`
	ContactEmail *string `json:"contactEmail"`
	ContactPhone *string `json:"contactPhone"`
	LogoURL      *string `json:"logoUrl"`
	Notes        *string `json:"notes"`
}

// RequestPromotionRequest is the body for
// POST /contests/:id/request-promotion (":id" is the CHILD contest).
// TopN <= 0 falls back to the child contest's default_promote_top_n.
type RequestPromotionRequest struct {
	ParentContestID string `json:"parentContestId" binding:"required"`
	TopN            int    `json:"topN"`
}

// RejectPromotionRequest is the body for
// POST /contest-promotions/:id/reject.
type RejectPromotionRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// --- Sentinel errors ---

var (
	ErrPromotionSelfParent          = errors.New("connect: a contest cannot be promoted into itself")
	ErrPromotionCycle               = errors.New("connect: promotion would create a contest hierarchy cycle")
	ErrPromotionResultsNotPublished = errors.New("connect: child contest results are not published/locked yet")
	ErrPromotionTopNInvalid         = errors.New("connect: topN must be positive and not exceed the number of ranked results")
	ErrPromotionNotFound            = errors.New("connect: promotion request not found")
	ErrPromotionNotPending          = errors.New("connect: promotion request is not pending")
	ErrPromotionSelfApproval        = errors.New("connect: approver must be a different admin than the requester")
	ErrPartnerNotFound              = errors.New("connect: contest partner not found")
	ErrPartnerNameRequired          = errors.New("connect: partner name is required")
)
