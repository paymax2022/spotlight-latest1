package connectmentor

import (
	"context"
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound       = errors.New("connect: mentorship record not found")
	ErrInvalidInput   = errors.New("connect: invalid mentorship input")
	ErrSelfMatch      = errors.New("connect: cannot mentor yourself")
	ErrNotMentor      = errors.New("connect: only the mentor may accept/decline this request")
	ErrNotParticipant = errors.New("connect: only a participant may transition this match")
	ErrBadTransition  = errors.New("connect: invalid mentorship state transition")
)

// Auditor mirrors the per-package Connect audit hook; nil-safe at call sites.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// LoyaltyAwarder is the ONE Paymax Black emit seam (PN-8). The composition root
// injects an adapter that wraps loyalty.AwardFor with a points.EarnContext of
// {Module:"connect", Reference: ref}. This package therefore depends only on this
// tiny interface — never on the points/loyalty packages directly — keeping it
// self-contained. There is NO second currency: the currency stays the points/
// loyalty ledger; connect_networking_loyalty_log is only an emit AUDIT (ADM-GM-01).
type LoyaltyAwarder interface {
	AwardFor(ctx context.Context, userID, module, trigger, ref string) error
}

// Service owns the mentorship opt-in, safe discovery, guarded FSM, and the dual
// loyalty emit on completion.
type Service struct {
	repo    *Repository
	loyalty LoyaltyAwarder
	audit   Auditor
}

func NewService(repo *Repository, loyalty LoyaltyAwarder, audit Auditor) *Service {
	return &Service{repo: repo, loyalty: loyalty, audit: audit}
}

// OptIn upserts the caller's mentorship profile (MN-01). Self-opt-in, no approval
// gate (PN-9).
func (s *Service) OptIn(ctx context.Context, userID string, in OptInInput) (*MentorshipProfile, error) {
	if !isRole(in.Role) {
		return nil, ErrInvalidInput
	}
	p, err := s.repo.UpsertProfile(ctx, userID, in.Role, in.Domains, in.Capacity)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.mentorship.optin", userID, "connect_mentorship_profile", p.ID,
		map[string]any{"role": p.Role, "domains": p.Domains})
	return p, nil
}

// Discover returns the PN-7 SAFE projection of opt-in mentors (MN-02).
func (s *Service) Discover(ctx context.Context, viewerID, domain string, limit int) ([]SafeMentorProfile, error) {
	return s.repo.DiscoverMentors(ctx, viewerID, domain, limit)
}

// RequestMatch creates a pending match from mentee → mentor (MN-03). Idempotent on
// the (mentor,mentee) pair.
func (s *Service) RequestMatch(ctx context.Context, menteeID string, in MatchRequestInput) (*MentorshipMatch, error) {
	if in.MentorID == "" {
		return nil, ErrInvalidInput
	}
	if in.MentorID == menteeID {
		return nil, ErrSelfMatch
	}
	m, err := s.repo.InsertMatch(ctx, in.MentorID, menteeID)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.mentorship.request", menteeID, "connect_mentorship_match", m.ID,
		map[string]any{"mentorId": in.MentorID, "state": m.State})
	return m, nil
}

// RespondMatch lets the mentor accept/decline a REQUESTED match (MN-03). Object-level
// authz: only the mentor may respond.
func (s *Service) RespondMatch(ctx context.Context, actorID, matchID string, accept bool) (*MentorshipMatch, error) {
	m, err := s.repo.GetMatch(ctx, matchID)
	if err != nil {
		return nil, err
	}
	if m.MentorID != actorID {
		return nil, ErrNotMentor
	}
	to := StateDeclined
	if accept {
		to = StateAccepted
	}
	applied, updated, err := s.repo.TransitionMatch(ctx, matchID, StateRequested, to)
	if err != nil {
		return nil, err
	}
	if !applied {
		return nil, ErrBadTransition
	}
	s.writeAudit(ctx, "connect.mentorship.respond", actorID, "connect_mentorship_match", matchID,
		map[string]any{"state": string(to)})
	return updated, nil
}

// Transition applies an active/paused/completed/ended_early transition (MN-06 for
// COMPLETED). Either participant may drive it. On COMPLETED it emits the dual
// Paymax Black loyalty event (both parties, distinct references — exactly once) and
// returns the mutual-testimonial hint the FE routes into RC-01.
func (s *Service) Transition(ctx context.Context, actorID, matchID string, to MatchState) (*TransitionResult, error) {
	m, err := s.repo.GetMatch(ctx, matchID)
	if err != nil {
		return nil, err
	}
	if m.MentorID != actorID && m.MenteeID != actorID {
		return nil, ErrNotParticipant
	}
	from := MatchState(m.State)
	if !validTransition(from, to) {
		return nil, ErrBadTransition
	}
	applied, updated, err := s.repo.TransitionMatch(ctx, matchID, from, to)
	if err != nil {
		return nil, err
	}
	if !applied {
		// A concurrent transition won the race; not our state change → do NOT emit.
		return nil, ErrBadTransition
	}
	s.writeAudit(ctx, "connect.mentorship.transition", actorID, "connect_mentorship_match", matchID,
		map[string]any{"from": string(from), "to": string(to)})

	res := &TransitionResult{Match: updated}
	if to == StateCompleted {
		// The guarded write above is the idempotency gate: this branch runs exactly
		// once per completed match, so each party is awarded exactly once. Distinct
		// references + points-ledger idempotency + the loyalty-log UNIQUE(reference)
		// are the defence-in-depth backstops against a retried call.
		s.emitCompletion(ctx, updated)
		res.TestimonialHint = &TestimonialHint{
			Flow: RecommendationFlow, // RC-01
			Prompts: []TestimonialPrompt{
				{AuthorID: updated.MentorID, SubjectID: updated.MenteeID},
				{AuthorID: updated.MenteeID, SubjectID: updated.MentorID},
			},
		}
	}
	return res, nil
}

// emitCompletion issues the dual Paymax Black emit for a completed match and records
// each emit in the append-only loyalty AUDIT log (ADM-GM-01). A loyalty failure must
// never unwind the (already-committed) completion — errors are audited, not raised.
func (s *Service) emitCompletion(ctx context.Context, m *MentorshipMatch) {
	mentorRef, menteeRef := completionRefs(m.ID)
	s.awardAndLog(ctx, m.MentorID, mentorRef, m.ID)
	s.awardAndLog(ctx, m.MenteeID, menteeRef, m.ID)
}

func (s *Service) awardAndLog(ctx context.Context, userID, ref, matchID string) {
	if s.loyalty != nil {
		if err := s.loyalty.AwardFor(ctx, userID, LoyaltyModule, TriggerMentorshipDone, ref); err != nil {
			s.writeAudit(ctx, "connect.mentorship.loyalty.error", userID, "connect_mentorship_match", matchID,
				map[string]any{"ref": ref, "err": err.Error()})
			return
		}
	}
	// Record the emit for ADM-GM-01 trace (idempotent on reference). repo is nil only
	// in unit tests that exercise the emit seam without a DB.
	if s.repo == nil {
		return
	}
	if err := s.repo.AppendLoyaltyLog(ctx, userID, TriggerMentorshipDone, ref, matchID); err != nil {
		s.writeAudit(ctx, "connect.mentorship.loyalty.log_error", userID, "connect_mentorship_match", matchID,
			map[string]any{"ref": ref, "err": err.Error()})
	}
}

// ListMyMatches returns the caller's mentorship matches.
func (s *Service) ListMyMatches(ctx context.Context, userID string) ([]MentorshipMatch, error) {
	return s.repo.ListMatchesForUser(ctx, userID)
}

// MentorshipReports lists matches for moderation oversight (ADM-MN-01). Optional
// state filter; empty = all.
func (s *Service) MentorshipReports(ctx context.Context, state string, limit int) ([]MentorshipMatch, error) {
	return s.repo.ListMatchesByState(ctx, state, limit)
}

// LoyaltyAudit traces the Phase-6 Paymax Black emissions for a user (ADM-GM-01).
func (s *Service) LoyaltyAudit(ctx context.Context, userID string, limit int) ([]LoyaltyLogEntry, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.LoyaltyLogForUser(ctx, userID, limit)
}

func (s *Service) writeAudit(ctx context.Context, action, actorID, entityType, entityID string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	_ = s.audit.WriteAudit(ctx, action, actorID, entityType, entityID, meta)
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrSelfMatch):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotMentor), errors.Is(err, ErrNotParticipant):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBadTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// OptIn — POST /mentorship/opt-in (MN-01). Upsert is naturally idempotent.
func (h *Handler) OptIn(c *gin.Context) {
	var in OptInInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.OptIn(c.Request.Context(), ginutil.UserID(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Discover — GET /mentorship/discovery?domain=&limit= (MN-02, PN-7 safe projection).
func (h *Handler) Discover(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.Discover(c.Request.Context(), ginutil.UserID(c), c.Query("domain"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RequestMatch — POST /mentorship/matches (MN-03). Idempotent per (mentor,mentee).
func (h *Handler) RequestMatch(c *gin.Context) {
	var in MatchRequestInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.RequestMatch(c.Request.Context(), ginutil.UserID(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RespondMatch — POST /mentorship/matches/:id/respond (MN-03). Mentor accept/decline.
func (h *Handler) RespondMatch(c *gin.Context) {
	var in MatchRespondInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.RespondMatch(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in.Accept)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// TransitionMatch — PATCH /mentorship/matches/:id/state. Drives active/paused/
// completed/ended_early. On COMPLETED (MN-06) the response carries testimonialHint.
func (h *Handler) TransitionMatch(c *gin.Context) {
	var in StateTransitionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.Transition(c.Request.Context(), ginutil.UserID(c), c.Param("id"), MatchState(in.State))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ListMyMatches — GET /mentorship/matches.
func (h *Handler) ListMyMatches(c *gin.Context) {
	out, err := h.svc.ListMyMatches(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminReports — GET /mentorship/reports?state=&limit= (ADM-MN-01).
func (h *Handler) AdminReports(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.MentorshipReports(c.Request.Context(), c.Query("state"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminLoyaltyAudit — GET /mentorship/loyalty-audit?userId=&limit= (ADM-GM-01).
func (h *Handler) AdminLoyaltyAudit(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.LoyaltyAudit(c.Request.Context(), c.Query("userId"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Register wires the mentorship module onto the shared Connect member + admin
// groups. Member mentorship is self-opt-in (PN-9), so no member permission gate is
// applied. Admin routes add per-route RBAC (connect.moderation.manage). The single
// Paymax Black emit seam is the injected LoyaltyAwarder (PN-8) — no direct points
// dependency here.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, loyalty LoyaltyAwarder, audit Auditor) {
	svc := NewService(NewRepository(pool), loyalty, audit)
	h := NewHandler(svc)

	g := member.Group("/networking/mentorship")
	g.POST("/opt-in", h.OptIn)
	g.GET("/discovery", h.Discover)
	g.GET("/matches", h.ListMyMatches)
	g.POST("/matches", h.RequestMatch)
	g.POST("/matches/:id/respond", h.RespondMatch)
	g.PATCH("/matches/:id/state", h.TransitionMatch)

	ag := admin.Group("/networking/mentorship")
	ag.GET("/reports",
		middleware.RequirePermission(rbac, "connect.moderation.manage"), h.AdminReports)
	ag.GET("/loyalty-audit",
		middleware.RequirePermission(rbac, "connect.moderation.manage"), h.AdminLoyaltyAudit)
}
