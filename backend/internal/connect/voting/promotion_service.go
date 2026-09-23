package connectvoting

import (
	"context"
	"fmt"
	"strings"
)

// ─── Partners ────────────────────────────────────────────────────────────────

func (s *Service) CreatePartner(ctx context.Context, req CreatePartnerRequest, actorID string) (*ContestPartner, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, ErrPartnerNameRequired
	}
	return s.repo.CreatePartner(ctx, name,
		nilIfEmpty(req.ContactEmail), nilIfEmpty(req.ContactPhone),
		nilIfEmpty(req.LogoURL), nilIfEmpty(req.Notes), actorID)
}

func (s *Service) ListPartners(ctx context.Context) ([]ContestPartner, error) {
	return s.repo.ListPartners(ctx)
}

func (s *Service) UpdatePartner(ctx context.Context, id string, req UpdatePartnerRequest) (*ContestPartner, error) {
	return s.repo.UpdatePartner(ctx, id, req.Name, req.ContactEmail, req.ContactPhone, req.LogoURL, req.Notes)
}

func nilIfEmpty(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

// ─── Child contests ───────────────────────────────────────────────────────────

func (s *Service) ListChildContests(ctx context.Context, parentContestID string) ([]ChildContest, error) {
	return s.repo.ListChildContests(ctx, parentContestID)
}

// ─── Promotion request / approve / reject ────────────────────────────────────

// RequestPromotion validates the child contest's results are published/
// locked, resolves topN (falling back to the child's default_promote_top_n
// when the caller passes 0), rejects a self-parent or cycle-forming request,
// and inserts one pending contest_promotions row per ranked contestant plus
// one contest_admin_approvals row for maker-checker surfacing.
func (s *Service) RequestPromotion(ctx context.Context, childContestID string, req RequestPromotionRequest, actorID string) ([]ContestPromotion, error) {
	parentContestID := strings.TrimSpace(req.ParentContestID)
	if parentContestID == "" {
		return nil, fmt.Errorf("connect: parentContestId is required")
	}
	if parentContestID == childContestID {
		return nil, ErrPromotionSelfParent
	}

	// Both contests must exist (GetContestHierarchy returns ErrNotFound
	// otherwise, which the handler maps to 404).
	if _, err := s.repo.GetContestHierarchy(ctx, childContestID); err != nil {
		return nil, err
	}
	if _, err := s.repo.GetContestHierarchy(ctx, parentContestID); err != nil {
		return nil, err
	}

	// Cycle guard: the parent must not already be a descendant of the child
	// (i.e. the child must not appear in the parent's own ancestor chain).
	// This mirrors what the DB trigger enforces for parent_contest_id writes
	// on `contests` itself — RequestPromotion never writes that column, so it
	// needs its own check to fail with a typed error rather than surfacing a
	// confusing downstream error later.
	isCycle, err := s.repo.IsDescendantOf(ctx, childContestID, parentContestID)
	if err != nil {
		return nil, err
	}
	if isCycle {
		return nil, ErrPromotionCycle
	}

	ranked, err := s.repo.LatestPublishedRoundResults(ctx, childContestID)
	if err != nil {
		return nil, err
	}
	if len(ranked) == 0 {
		return nil, ErrPromotionResultsNotPublished
	}

	topN := req.TopN
	if topN <= 0 {
		info, err := s.repo.GetContestHierarchy(ctx, childContestID)
		if err != nil {
			return nil, err
		}
		if info.DefaultPromoteTopN != nil {
			topN = *info.DefaultPromoteTopN
		}
	}
	if topN <= 0 || topN > len(ranked) {
		return nil, ErrPromotionTopNInvalid
	}

	selected := ranked[:topN]

	promotions, err := s.repo.CreatePromotionBatch(ctx, childContestID, parentContestID, selected, actorID)
	if err != nil {
		return nil, err
	}

	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "contest_promotion_requested", actorID, "contest", childContestID, map[string]any{
			"parentContestId": parentContestID,
			"topN":            topN,
			"promotionIds":    promotionIDs(promotions),
		})
	}

	return promotions, nil
}

func promotionIDs(ps []ContestPromotion) []string {
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = p.ID
	}
	return out
}

func (s *Service) GetPromotion(ctx context.Context, id string) (*ContestPromotion, error) {
	return s.repo.GetPromotion(ctx, id)
}

func (s *Service) ListPromotions(ctx context.Context, status string) ([]ContestPromotion, error) {
	return s.repo.ListPromotions(ctx, status)
}

// ApprovePromotion enforces maker-checker (approver must differ from
// requester — checked here AND by the contest_promotions_no_self_approval DB
// CHECK, belt and braces) then executes the promotion: a new contestant row
// is created under the parent contest and the promotion row is marked
// executed, atomically.
func (s *Service) ApprovePromotion(ctx context.Context, promotionID, approverID string) (*ContestPromotion, error) {
	p, err := s.repo.ApprovePromotion(ctx, promotionID, approverID)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "contest_promotion_approved", approverID, "contest_promotion", p.ID, map[string]any{
			"childContestId":  p.ChildContestID,
			"parentContestId": p.ParentContestID,
			"contestantId":    p.ContestantID,
			"newContestantId": p.NewContestantID,
		})
	}
	return p, nil
}

// RejectPromotion enforces the same maker-checker rule as ApprovePromotion.
func (s *Service) RejectPromotion(ctx context.Context, promotionID, approverID, reason string) (*ContestPromotion, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, fmt.Errorf("connect: rejection reason is required")
	}
	p, err := s.repo.RejectPromotion(ctx, promotionID, approverID, reason)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "contest_promotion_rejected", approverID, "contest_promotion", p.ID, map[string]any{
			"childContestId":  p.ChildContestID,
			"parentContestId": p.ParentContestID,
			"contestantId":    p.ContestantID,
			"reason":          reason,
		})
	}
	return p, nil
}
