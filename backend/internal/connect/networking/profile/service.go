package connectnetprofile

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrNotFound      = errors.New("connect: network profile record not found")
	ErrInvalidInput  = errors.New("connect: invalid input")
	ErrSelfReco      = errors.New("connect: cannot write a recommendation about yourself")
	ErrNotSubject    = errors.New("connect: only the subject may accept or decline this recommendation")
	ErrNotAuthor     = errors.New("connect: only the author may send this recommendation")
	ErrBadTransition = errors.New("connect: invalid recommendation state transition")
	ErrSelfRequest   = errors.New("connect: cannot request a recommendation from yourself")
)

// Auditor mirrors the per-package Connect audit hook; every mutation flows through it.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// Service owns Phase 6C/6E logic: experience/education/about, the PN-1-safe
// profile-strength calc, and the PN-4 consent-gated recommendation state machine.
// NON-CASH: this service never touches the finance ledger/wallet.
type Service struct {
	repo  *Repository
	audit Auditor
}

func NewService(repo *Repository, audit Auditor) *Service {
	return &Service{repo: repo, audit: audit}
}

// ─────────────────────────────── Experience ──────────────────────────────────

func (s *Service) AddExperience(ctx context.Context, userID string, in ExperienceInput, idemKey string) (*Experience, error) {
	if strings.TrimSpace(in.Title) == "" || strings.TrimSpace(in.Company) == "" || in.StartDate == "" {
		return nil, ErrInvalidInput
	}
	e, err := s.repo.InsertExperience(ctx, userID, in, idemKey)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.experience.add", userID, "connect_experience", e.ID,
		map[string]any{"title": e.Title, "company": e.Company})
	return e, nil
}

func (s *Service) UpdateExperience(ctx context.Context, userID, id string, in ExperienceInput) (*Experience, error) {
	if strings.TrimSpace(in.Title) == "" || strings.TrimSpace(in.Company) == "" || in.StartDate == "" {
		return nil, ErrInvalidInput
	}
	e, err := s.repo.UpdateExperience(ctx, userID, id, in)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.experience.update", userID, "connect_experience", e.ID, nil)
	return e, nil
}

func (s *Service) DeleteExperience(ctx context.Context, userID, id string) error {
	if err := s.repo.DeleteExperience(ctx, userID, id); err != nil {
		return err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.experience.delete", userID, "connect_experience", id, nil)
	return nil
}

func (s *Service) ListExperience(ctx context.Context, userID string) ([]Experience, error) {
	return s.repo.ListExperience(ctx, userID)
}

// ─────────────────────────────── Education ───────────────────────────────────

func (s *Service) AddEducation(ctx context.Context, userID string, in EducationInput, idemKey string) (*Education, error) {
	if strings.TrimSpace(in.Institution) == "" || in.StartDate == "" {
		return nil, ErrInvalidInput
	}
	e, err := s.repo.InsertEducation(ctx, userID, in, idemKey)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.education.add", userID, "connect_education", e.ID,
		map[string]any{"institution": e.Institution})
	return e, nil
}

func (s *Service) UpdateEducation(ctx context.Context, userID, id string, in EducationInput) (*Education, error) {
	if strings.TrimSpace(in.Institution) == "" || in.StartDate == "" {
		return nil, ErrInvalidInput
	}
	e, err := s.repo.UpdateEducation(ctx, userID, id, in)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.education.update", userID, "connect_education", e.ID, nil)
	return e, nil
}

func (s *Service) DeleteEducation(ctx context.Context, userID, id string) error {
	if err := s.repo.DeleteEducation(ctx, userID, id); err != nil {
		return err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.education.delete", userID, "connect_education", id, nil)
	return nil
}

func (s *Service) ListEducation(ctx context.Context, userID string) ([]Education, error) {
	return s.repo.ListEducation(ctx, userID)
}

// ─────────────────────────────────── About ───────────────────────────────────

func (s *Service) GetAbout(ctx context.Context, userID string) (*About, error) {
	return s.repo.GetAbout(ctx, userID)
}

func (s *Service) SetAbout(ctx context.Context, userID string, in AboutInput) (*About, error) {
	a, err := s.repo.UpsertAbout(ctx, userID, strings.TrimSpace(in.Summary))
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.about.set", userID, "connect_network_about", userID, nil)
	return a, nil
}

// ──────────────────────────── Recommendations ────────────────────────────────

// WriteRecommendation is RC-01. The author creates a recommendation about the
// subject. It starts DRAFTED (author may send later) or SENT (default). It is
// NEVER created visible — publication requires the subject's explicit accept (PN-4).
func (s *Service) WriteRecommendation(ctx context.Context, authorID string, in WriteRecommendationInput) (*Recommendation, error) {
	if authorID == in.SubjectUserID {
		return nil, ErrSelfReco
	}
	if strings.TrimSpace(in.Body) == "" {
		return nil, ErrInvalidInput
	}
	state := RecoSent
	if in.Draft {
		state = RecoDrafted
	}
	rec, err := s.repo.InsertRecommendation(ctx, authorID, in.SubjectUserID, strings.TrimSpace(in.Body), state)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.recommendation.write", authorID, "connect_recommendation", rec.ID,
		map[string]any{"subject_user_id": in.SubjectUserID, "state": rec.State})
	return rec, nil
}

// checkSend is the pure author-only guard for DRAFTED → SENT.
func checkSend(actorID, authorID string, current RecoState) error {
	if authorID != actorID {
		return ErrNotAuthor
	}
	if !validTransition(current, RecoSent) {
		return ErrBadTransition
	}
	return nil
}

// checkRespond is the pure PN-4 guard for accept/decline: ONLY the subject may
// respond, and only along a legal FSM edge. Extracted so the invariant is
// unit-testable without a database.
func checkRespond(actorID, subjectID string, current, to RecoState) error {
	if subjectID != actorID {
		return ErrNotSubject
	}
	if !validTransition(current, to) {
		return ErrBadTransition
	}
	return nil
}

// SendRecommendation transitions DRAFTED → SENT. Author-only.
func (s *Service) SendRecommendation(ctx context.Context, actorID, id string) (*Recommendation, error) {
	rec, err := s.repo.GetRecommendationByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := checkSend(actorID, rec.AuthorUserID, RecoState(rec.State)); err != nil {
		return nil, err
	}
	out, err := s.repo.TransitionRecommendation(ctx, id, RecoState(rec.State), RecoSent)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.recommendation.send", actorID, "connect_recommendation", id,
		map[string]any{"state": string(RecoSent)})
	return out, nil
}

// AcceptRecommendation transitions SENT → ACCEPTED_VISIBLE. PN-4: SUBJECT ONLY.
// This is the explicit, non-automatic action that publishes a recommendation.
func (s *Service) AcceptRecommendation(ctx context.Context, actorID, id string) (*Recommendation, error) {
	return s.respondToRecommendation(ctx, actorID, id, RecoAcceptedVisible)
}

// DeclineRecommendation transitions SENT → DECLINED_HIDDEN. PN-4: SUBJECT ONLY.
func (s *Service) DeclineRecommendation(ctx context.Context, actorID, id string) (*Recommendation, error) {
	return s.respondToRecommendation(ctx, actorID, id, RecoDeclinedHidden)
}

func (s *Service) respondToRecommendation(ctx context.Context, actorID, id string, to RecoState) (*Recommendation, error) {
	rec, err := s.repo.GetRecommendationByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// PN-4 object-level authz: ONLY the subject may accept/decline. The author
	// cannot self-publish their own recommendation.
	if err := checkRespond(actorID, rec.SubjectUserID, RecoState(rec.State), to); err != nil {
		return nil, err
	}
	out, err := s.repo.TransitionRecommendation(ctx, id, RecoState(rec.State), to)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.recommendation.respond", actorID, "connect_recommendation", id,
		map[string]any{"state": string(to)})
	return out, nil
}

// Inbox is RC-02: the caller's pending (sent) recommendations awaiting a decision.
func (s *Service) Inbox(ctx context.Context, subjectID string) ([]Recommendation, error) {
	return s.repo.ListInboxForSubject(ctx, subjectID)
}

// Authored lists the caller's own written recommendations (any state).
func (s *Service) Authored(ctx context.Context, authorID string) ([]Recommendation, error) {
	return s.repo.ListAuthored(ctx, authorID)
}

// PublicRecommendations is RC-03: the accepted-only recommendations on a profile.
// PN-4 is enforced in the repo query (WHERE state='accepted_visible') AND the RLS
// reader policy — this method never returns drafted/sent/declined rows.
func (s *Service) PublicRecommendations(ctx context.Context, subjectID string) ([]Recommendation, error) {
	return s.repo.ListAcceptedForSubject(ctx, subjectID)
}

// RequestRecommendation is RC-04: ask a connection to write one.
func (s *Service) RequestRecommendation(ctx context.Context, requesterID string, in RequestRecommendationInput) (*RecommendationRequest, error) {
	if requesterID == in.TargetUserID {
		return nil, ErrSelfRequest
	}
	req, err := s.repo.InsertRecommendationRequest(ctx, requesterID, in.TargetUserID, strings.TrimSpace(in.Note))
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.recommendation.request", requesterID,
		"connect_recommendation_request", req.ID, map[string]any{"target_user_id": in.TargetUserID})
	return req, nil
}

// ──────────────────────── Profile strength (PR-11) ───────────────────────────

// Strength gathers signals from the user's own data and returns a PN-1-safe view
// (coarse band + missing sections). The raw numeric score never leaves this
// process. The verified badge is gathered server-side (never client-supplied);
// if its backing projection is unavailable the signal fails closed to false.
// PassedAssessment is wired false until the Phase 6F skill-assessment tables land.
func (s *Service) Strength(ctx context.Context, userID string) (StrengthView, error) {
	verified := s.repo.VerifiedBadge(ctx, userID)
	const passedAssessment = false // TODO(phase-6F): read connect_skill_assessment_attempts
	hasExp, err := s.repo.HasExperience(ctx, userID)
	if err != nil {
		return StrengthView{}, err
	}
	hasEdu, err := s.repo.HasEducation(ctx, userID)
	if err != nil {
		return StrengthView{}, err
	}
	hasAbout, err := s.repo.HasAbout(ctx, userID)
	if err != nil {
		return StrengthView{}, err
	}
	acceptedRecos, err := s.repo.CountAcceptedForSubject(ctx, userID)
	if err != nil {
		return StrengthView{}, err
	}
	signals := StrengthSignals{
		HasExperience:           hasExp,
		HasEducation:            hasEdu,
		HasAbout:                hasAbout,
		VerifiedBadge:           verified,
		PassedAssessment:        passedAssessment,
		AcceptedRecommendations: acceptedRecos,
	}
	return BuildStrengthView(signals), nil
}

// ─────────────────────────────────── Admin ───────────────────────────────────

func (s *Service) AdminListRecommendations(ctx context.Context, state string, limit int) ([]Recommendation, error) {
	return s.repo.AdminList(ctx, state, limit)
}

func (s *Service) AdminHideRecommendation(ctx context.Context, adminID, id string) (*Recommendation, error) {
	rec, err := s.repo.AdminHideRecommendation(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.network.recommendation.moderate", adminID, "connect_recommendation", id,
		map[string]any{"state": string(RecoDeclinedHidden), "action": "hide"})
	return rec, nil
}
