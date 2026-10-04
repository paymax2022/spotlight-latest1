package connectlive

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

var (
	ErrNotFound      = errors.New("connect: live session not found")
	ErrNotHost       = errors.New("connect: only the host may perform this action")
	ErrBadState      = errors.New("connect: live session is not in a valid state for this action")
	ErrInvalidInput  = errors.New("connect: invalid input")
	ErrCohostFull    = errors.New("connect: co-host slots are full")
	ErrRTCUnconfig   = errors.New("connect: RTC provider is not configured")
	ErrBadModeration = errors.New("connect: unknown moderation action")
)

// Auditor mirrors the per-package interface used across Connect; every admin /
// moderation action is written through it.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// RTCConfig carries the realtime-media provider credentials. It is populated from
// backend config/env at wiring time — secrets are NEVER hard-coded in this package.
// An empty AppSecret means the provider is unconfigured and token issuance is
// refused fail-closed.
type RTCConfig struct {
	Provider  string
	AppID     string
	AppSecret string
	TokenTTL  time.Duration
}

// RTCTokenIssuer mints a join credential for a session/user. The default
// implementation (hmacIssuer) signs a deterministic claim with the configured
// secret; a real deployment can swap in a VideoSDK adapter behind this
// interface without touching the service.
type RTCTokenIssuer interface {
	Issue(ctx context.Context, sessionID, userID, role string) (*RTCToken, error)
}

// Service is the live-session lifecycle service.
type Service struct {
	repo  *Repository
	audit Auditor
	rtc   RTCTokenIssuer
}

func NewService(repo *Repository, audit Auditor, rtc RTCTokenIssuer) *Service {
	return &Service{repo: repo, audit: audit, rtc: rtc}
}

const defaultMaxCohosts = 3

// CreateSession opens a scheduled session owned by the caller.
func (s *Service) CreateSession(ctx context.Context, hostID string, in CreateSessionInput) (*Session, error) {
	if in.Title == "" {
		return nil, ErrInvalidInput
	}
	sess, err := s.repo.CreateSession(ctx, hostID, in, defaultMaxCohosts)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.live.session.create", hostID, "connect_live_session", sess.ID,
		map[string]any{"title": in.Title, "low_bandwidth": in.LowBandwidth})
	return sess, nil
}

// Start moves a scheduled session live (host only).
func (s *Service) Start(ctx context.Context, actorID, sessionID string) (*Session, error) {
	if err := s.requireHost(ctx, actorID, sessionID); err != nil {
		return nil, err
	}
	sess, err := s.repo.SetStatus(ctx, sessionID, StatusScheduled, StatusLive)
	if err != nil {
		return nil, ErrBadState
	}
	_ = s.audit.WriteAudit(ctx, "connect.live.session.start", actorID, "connect_live_session", sessionID, nil)
	return sess, nil
}

// End moves a live session to ended (host only).
func (s *Service) End(ctx context.Context, actorID, sessionID string) (*Session, error) {
	if err := s.requireHost(ctx, actorID, sessionID); err != nil {
		return nil, err
	}
	sess, err := s.repo.SetStatus(ctx, sessionID, StatusLive, StatusEnded)
	if err != nil {
		return nil, ErrBadState
	}
	_ = s.audit.WriteAudit(ctx, "connect.live.session.end", actorID, "connect_live_session", sessionID, nil)
	return sess, nil
}

// Discover lists currently-live sessions for the feed.
func (s *Service) Discover(ctx context.Context, lowBandwidth bool, limit int) ([]Session, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.Discover(ctx, lowBandwidth, limit)
}

// Get returns a single session (no host restriction; readable to viewers).
func (s *Service) Get(ctx context.Context, sessionID string) (*Session, error) {
	return s.repo.GetSession(ctx, sessionID)
}

// Join records a viewer joining and returns the refreshed viewer count.
func (s *Service) Join(ctx context.Context, userID, sessionID string) (int, error) {
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return 0, err
	}
	if sess.Status != StatusLive {
		return 0, ErrBadState
	}
	if _, err := s.repo.UpsertParticipant(ctx, sessionID, userID, RoleViewer, StateActive); err != nil {
		return 0, err
	}
	return s.repo.RecountViewers(ctx, sessionID)
}

// Leave records a viewer leaving and returns the refreshed viewer count.
func (s *Service) Leave(ctx context.Context, userID, sessionID string) (int, error) {
	if err := s.repo.SetParticipantState(ctx, sessionID, userID, StateLeft); err != nil && !errors.Is(err, ErrNotFound) {
		return 0, err
	}
	return s.repo.RecountViewers(ctx, sessionID)
}

// Cohost handles both the host's invite and the invitee's accept/decline.
func (s *Service) Cohost(ctx context.Context, actorID, sessionID string, in CohostInput) (*Participant, error) {
	if in.UserID == "" {
		return nil, ErrInvalidInput
	}
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	// Invite path: host invites another user (state=invited).
	if in.Accept == nil {
		if sess.HostID != actorID {
			return nil, ErrNotHost
		}
		n, err := s.repo.CountActiveCohosts(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		if n >= sess.MaxCohosts {
			return nil, ErrCohostFull
		}
		p, err := s.repo.UpsertParticipant(ctx, sessionID, in.UserID, RoleCohost, StateInvited)
		if err != nil {
			return nil, err
		}
		_ = s.audit.WriteAudit(ctx, "connect.live.cohost.invite", actorID, "connect_live_session", sessionID,
			map[string]any{"invitee": in.UserID})
		return p, nil
	}
	// Response path: the invitee (actor) accepts/declines their own invite.
	if in.UserID != actorID {
		return nil, ErrNotHost
	}
	state := StateLeft
	if *in.Accept {
		n, err := s.repo.CountActiveCohosts(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		if n >= sess.MaxCohosts {
			return nil, ErrCohostFull
		}
		state = StateActive
	}
	p, err := s.repo.UpsertParticipant(ctx, sessionID, actorID, RoleCohost, state)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.live.cohost.respond", actorID, "connect_live_session", sessionID,
		map[string]any{"accepted": *in.Accept})
	return p, nil
}

// PK opens a battle (host only) and/or applies a non-cash score delta. Scores are
// gamification counters — NEVER money.
func (s *Service) PK(ctx context.Context, actorID, sessionID string, in PKInput) (*PKBattle, error) {
	if err := s.requireHost(ctx, actorID, sessionID); err != nil {
		return nil, err
	}
	if in.Delta != 0 {
		side := in.Side
		if side != "opponent" {
			side = "host"
		}
		b, err := s.repo.ScorePK(ctx, sessionID, side, in.Delta)
		if err == nil {
			return b, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		// no active battle yet — fall through to create then score
	}
	b, err := s.repo.CreatePKBattle(ctx, sessionID, in.OpponentSessionID)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.live.pk.create", actorID, "connect_pk_battle", b.ID,
		map[string]any{"opponent": in.OpponentSessionID})
	return b, nil
}

// Moderate mutes/unmutes/kicks a participant (host only).
func (s *Service) Moderate(ctx context.Context, actorID, sessionID string, in ModerateInput) error {
	if err := s.requireHost(ctx, actorID, sessionID); err != nil {
		return err
	}
	var state string
	switch in.Action {
	case "mute":
		state = StateMuted
	case "unmute":
		state = StateActive
	case "kick":
		state = StateKicked
	default:
		return ErrBadModeration
	}
	if err := s.repo.SetParticipantState(ctx, sessionID, in.TargetUserID, state); err != nil {
		return err
	}
	_ = s.audit.WriteAudit(ctx, "connect.live.moderate", actorID, "connect_live_participant", in.TargetUserID,
		map[string]any{"session_id": sessionID, "action": in.Action})
	return nil
}

// IssueRTCToken mints a realtime-media credential for the caller. Refuses
// fail-closed when no provider is configured.
func (s *Service) IssueRTCToken(ctx context.Context, userID, sessionID string) (*RTCToken, error) {
	if s.rtc == nil {
		return nil, ErrRTCUnconfig
	}
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	role := RoleViewer
	if sess.HostID == userID {
		role = RoleHost
	}
	return s.rtc.Issue(ctx, sessionID, userID, role)
}

// AdminTerminate force-terminates any non-terminal session (RBAC connect.live.*).
func (s *Service) AdminTerminate(ctx context.Context, actorID, sessionID string) (*Session, error) {
	sess, err := s.repo.ForceTerminate(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.live.session.terminate", actorID, "connect_live_session", sessionID, nil)
	return sess, nil
}

// AdminList returns recently-live sessions for moderation review.
func (s *Service) AdminList(ctx context.Context, limit int) ([]Session, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	// Reuse Discover for the live feed; admins primarily watch live sessions.
	return s.repo.Discover(ctx, false, limit)
}

func (s *Service) requireHost(ctx context.Context, actorID, sessionID string) error {
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if sess.HostID != actorID {
		return ErrNotHost
	}
	return nil
}

// hmacIssuer is a provider-agnostic default that signs a deterministic claim with
// the configured secret. It is a STUB: a real provider SDK (VideoSDK) plugs in
// behind RTCTokenIssuer. The secret is supplied via RTCConfig (read from env/
// config at wiring time) and never hard-coded.
type hmacIssuer struct{ cfg RTCConfig }

// NewRTCIssuer returns a config-driven issuer, or nil when unconfigured (empty
// AppSecret) so the service can refuse token issuance fail-closed.
func NewRTCIssuer(cfg RTCConfig) RTCTokenIssuer {
	if cfg.AppSecret == "" {
		return nil
	}
	if cfg.TokenTTL <= 0 {
		cfg.TokenTTL = time.Hour
	}
	return &hmacIssuer{cfg: cfg}
}

func (h *hmacIssuer) Issue(_ context.Context, sessionID, userID, role string) (*RTCToken, error) {
	exp := time.Now().Add(h.cfg.TokenTTL)
	channel := "connect_live_" + sessionID
	claim := fmt.Sprintf("%s|%s|%s|%s|%d", h.cfg.AppID, channel, userID, role, exp.Unix())
	return &RTCToken{
		SessionID: sessionID,
		UserID:    userID,
		Channel:   channel,
		Role:      role,
		Token:     cryptox.HMACSHA256Hex(h.cfg.AppSecret, claim),
		ExpiresAt: exp,
	}, nil
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// fail maps a service error to an HTTP status.
func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrNotHost):
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
	case errors.Is(err, ErrBadState), errors.Is(err, ErrCohostFull),
		errors.Is(err, ErrBadModeration), errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrRTCUnconfig):
		c.JSON(http.StatusServiceUnavailable, gin.H{keyError: httperr.Msg(c, http.StatusServiceUnavailable, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// Create — POST /live/sessions.
func (h *Handler) Create(c *gin.Context) {
	var in CreateSessionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	sess, err := h.svc.CreateSession(c.Request.Context(), ginutil.UserID(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": sess})
}

// Start — POST /live/sessions/:id/start.
func (h *Handler) Start(c *gin.Context) {
	sess, err := h.svc.Start(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// End — POST /live/sessions/:id/end.
func (h *Handler) End(c *gin.Context) {
	sess, err := h.svc.End(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// Discover — GET /live/sessions?low_bandwidth=&limit=.
func (h *Handler) Discover(c *gin.Context) {
	low, _ := strconv.ParseBool(c.Query("low_bandwidth"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.Discover(c.Request.Context(), low, limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Get — GET /live/sessions/:id.
func (h *Handler) Get(c *gin.Context) {
	sess, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// Cohost — POST /live/sessions/:id/cohost (invite or accept/decline).
func (h *Handler) Cohost(c *gin.Context) {
	var in CohostInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.Cohost(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// PK — POST /live/sessions/:id/pk (create battle / apply non-cash score).
func (h *Handler) PK(c *gin.Context) {
	var in PKInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	b, err := h.svc.PK(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": b})
}

// Moderate — POST /live/sessions/:id/moderate (mute/unmute/kick).
func (h *Handler) Moderate(c *gin.Context) {
	var in ModerateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.Moderate(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// RTCToken — POST /live/sessions/:id/rtc-token.
func (h *Handler) RTCToken(c *gin.Context) {
	tok, err := h.svc.IssueRTCToken(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tok})
}

// AdminList — GET /live/sessions (admin moderation view).
func (h *Handler) AdminList(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.AdminList(c.Request.Context(), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminTerminate — POST /live/sessions/:id/terminate.
func (h *Handler) AdminTerminate(c *gin.Context) {
	sess, err := h.svc.AdminTerminate(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// Register wires the live module onto the shared Connect member + admin groups
// (both already carry RequireAuthContext + user_id). Admin routes add per-route
// RBAC (connect.live.*). The RTC issuer is supplied by the caller from config —
// provider secrets are never read here.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit Auditor, rtc RTCTokenIssuer) {
	svc := NewService(NewRepository(pool), audit, rtc)
	h := NewHandler(svc)

	g := member.Group("/live")
	g.POST("/sessions", h.Create)
	g.GET("/sessions", h.Discover)
	g.GET("/sessions/:id", h.Get)
	g.POST("/sessions/:id/start", h.Start)
	g.POST("/sessions/:id/end", h.End)
	g.POST("/sessions/:id/cohost", h.Cohost)
	g.POST("/sessions/:id/pk", h.PK)
	g.POST("/sessions/:id/moderate", h.Moderate)
	g.POST("/sessions/:id/rtc-token", h.RTCToken)

	ag := admin.Group("/live")
	ag.GET("/sessions",
		middleware.RequirePermission(rbac, "connect.live.view"), h.AdminList)
	ag.POST("/sessions/:id/terminate",
		middleware.RequirePermission(rbac, "connect.live.moderate"), h.AdminTerminate)
}
