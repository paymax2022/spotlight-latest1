package app

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/integrations/livekit"
	"spotlight/backend/internal/services"
)

var consultErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, consultengine.ErrInvalid),
	httperr.R(http.StatusNotFound, consultengine.ErrNotFound),
	httperr.R(http.StatusConflict, consultengine.ErrState,
		consultengine.ErrExtensionNotPayable, consultengine.ErrPaymentExpired),
	// PayExtension debits the payer's wallet; an underfunded patient must get a
	// payment-required answer, not a 500. The escrow layer wraps this sentinel.
	httperr.R(http.StatusPaymentRequired, ledger.ErrInsufficientFunds),
	// The tier gate refuses the debit before it is posted; that is a policy
	// answer, not a server fault.
	httperr.R(http.StatusForbidden, tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded),
	httperr.R(http.StatusServiceUnavailable, consultengine.ErrMediaUnavailable,
		consultengine.ErrEscrowUnavailable, escrow.ErrReconPending))

type consultAPI interface {
	PublishPackage(ctx context.Context, callerID string, pkg consultengine.Package) (consultengine.Package, error)
	ListPackages(ctx context.Context, vertical consultengine.Vertical, ownerKind consultengine.OwnerKind, ownerID string) ([]consultengine.Package, error)
	GetPackage(ctx context.Context, id string) (consultengine.Package, error)
	Get(ctx context.Context, sessionID, callerID string) (consultengine.Session, error)
	Join(ctx context.Context, sessionID, callerID string) (consultengine.Join, error)
	Complete(ctx context.Context, sessionID, callerID string) error
	RequestExtension(ctx context.Context, sessionID, callerID string, minutes int) (consultengine.Extension, error)
	DecideExtension(ctx context.Context, sessionID, extID, callerID string, approve bool, reason string) (consultengine.Extension, error)
	PayExtension(ctx context.Context, sessionID, extID, callerID string) (consultengine.Extension, consultengine.Session, error)
	PostMessage(ctx context.Context, sessionID, callerID, body string) (consultengine.Message, error)
	ListMessages(ctx context.Context, sessionID, callerID string, after time.Time) ([]consultengine.Message, error)
	ListExtensions(ctx context.Context, sessionID, callerID string) ([]consultengine.Extension, error)
}

var _ consultAPI = (*consultengine.Service)(nil)

// consultPathID returns the UUID path parameter name, refusing a malformed one
// at the handler boundary so pgx never receives a value it would turn into a
// 500. A malformed id cannot name a row, and 404 mirrors the engine's
// non-participant folding: expose nothing about existence.
func consultPathID(c *gin.Context, name string) (string, bool) {
	id := c.Param(name)
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return "", false
	}
	return id, true
}

type consultHandler struct{ svc consultAPI }

func (h *consultHandler) listPackages(c *gin.Context) {
	vertical := consultengine.Vertical(c.Query("vertical"))
	items, err := h.svc.ListPackages(c.Request.Context(), vertical,
		consultengine.OwnerKind(c.Query("owner_kind")), c.Query("owner_id"))
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "packages": items})
}

func (h *consultHandler) getPackage(c *gin.Context) {
	id, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	pkg, err := h.svc.GetPackage(c.Request.Context(), id)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "package": pkg})
}

// listExtensions is participant-scoped inside the engine: a stranger's session
// id answers ErrNotFound, never an empty list that would confirm existence.
func (h *consultHandler) listExtensions(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	items, err := h.svc.ListExtensions(c.Request.Context(), sessionID, caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extensions": items})
}

type publishPackageBody struct {
	OwnerKind       string `json:"owner_kind"`
	OwnerID         string `json:"owner_id"`
	Vertical        string `json:"vertical"`
	Mode            string `json:"mode"`
	DurationMinutes int    `json:"duration_minutes"`
	PriceKobo       int64  `json:"price_kobo"`
	Active          *bool  `json:"active"`
}

func (h *consultHandler) publishPackage(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var b publishPackageBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	// owner_id is a body field (not a path identity), so a malformed value is a
	// bad request rather than a 404.
	if _, err := uuid.Parse(b.OwnerID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	active := true
	if b.Active != nil {
		active = *b.Active
	}
	pkg, err := h.svc.PublishPackage(c.Request.Context(), caller, consultengine.Package{
		OwnerKind: consultengine.OwnerKind(b.OwnerKind), OwnerID: b.OwnerID,
		Vertical: consultengine.Vertical(b.Vertical), Mode: consultengine.Mode(b.Mode),
		DurationMinutes: b.DurationMinutes, PriceKobo: b.PriceKobo, Active: active,
	})
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "package": pkg})
}

func (h *consultHandler) getSession(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	sess, err := h.svc.Get(c.Request.Context(), sessionID, caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "session": sess})
}

func (h *consultHandler) join(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	j, err := h.svc.Join(c.Request.Context(), sessionID, caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "token": j.Token, "rtc": j.RTC, "session": j.Session})
}

func (h *consultHandler) complete(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	if err := h.svc.Complete(c.Request.Context(), sessionID, caller); err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *consultHandler) requestExtension(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	var b struct {
		AddedMinutes int `json:"added_minutes"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	ext, err := h.svc.RequestExtension(c.Request.Context(), sessionID, caller, b.AddedMinutes)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extension": ext})
}

func (h *consultHandler) decideExtension(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	extID, ok := consultPathID(c, "ext")
	if !ok {
		return
	}
	var b struct {
		Approve *bool  `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if b.Approve == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "approve is required"})
		return
	}
	ext, err := h.svc.DecideExtension(c.Request.Context(), sessionID, extID, caller, *b.Approve, b.Reason)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extension": ext})
}

func (h *consultHandler) payExtension(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	extID, ok := consultPathID(c, "ext")
	if !ok {
		return
	}
	ext, sess, err := h.svc.PayExtension(c.Request.Context(), sessionID, extID, caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extension": ext, "session": sess})
}

func (h *consultHandler) listMessages(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	var after time.Time
	if raw := c.Query("after"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "after must be RFC3339"})
			return
		}
		after = t
	}
	msgs, err := h.svc.ListMessages(c.Request.Context(), sessionID, caller, after)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "messages": msgs})
}

func (h *consultHandler) postMessage(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	var b struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	m, err := h.svc.PostMessage(c.Request.Context(), sessionID, caller, b.Body)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": m})
}

// registerConsultHandlers mounts the routes on an already-authenticated group
// (the public package list is mounted on the engine's bare engine in RegisterConsult).
func registerConsultHandlers(g *gin.RouterGroup, api consultAPI) {
	h := &consultHandler{svc: api}
	g.GET("/sessions/:id", h.getSession)
	g.POST("/sessions/:id/join", h.join)
	g.POST("/sessions/:id/complete", h.complete)
	g.POST("/sessions/:id/extensions", h.requestExtension)
	g.POST("/sessions/:id/extensions/:ext/decide", h.decideExtension)
	g.POST("/sessions/:id/extensions/:ext/pay", h.payExtension)
	g.GET("/sessions/:id/extensions", h.listExtensions)
	g.GET("/sessions/:id/messages", h.listMessages)
	g.POST("/sessions/:id/messages", h.postMessage)
	g.POST("/packages", h.publishPackage) // provider, still user-scoped
}

type consultEscrowAdapter struct{ e *escrow.Service }

func (a consultEscrowAdapter) HoldWithPayee(ctx context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (string, error) {
	h, err := a.e.HoldWithPayee(ctx, payerID, payeeID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return "", err
	}
	return h.ID, nil
}

func (a consultEscrowAdapter) Release(ctx context.Context, escrowID, payeeID string) error {
	return a.e.Release(ctx, escrowID, payeeID)
}

func (a consultEscrowAdapter) Refund(ctx context.Context, escrowID string) error {
	return a.e.Refund(ctx, escrowID)
}

type consultAuditor struct{ a services.AuditService }

func (c consultAuditor) LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) {
	if c.a == nil {
		return
	}
	c.a.LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID, oldValues, newValues, ipAddress, userAgent, severity)
}

// RegisterConsult builds the engine and mounts /api/v1/consult. The public
// package list bypasses auth by design; every session route requires a user.
// The returned service is ready for RunSweeper.
func RegisterConsult(r *gin.Engine, authMW gin.HandlerFunc, pool *pgxpool.Pool, ledgerSvc *ledger.Service, lk *livekit.Client, cfg config.Config, audit services.AuditService) *consultengine.Service {
	if pool == nil {
		log.Println("[consult] nil pool — skipping consult routes")
		return nil
	}
	var esc consultengine.Escrow
	if ledgerSvc != nil {
		esc = consultEscrowAdapter{e: escrow.NewService(pool, ledgerSvc, nil)}
	}
	svc := consultengine.NewService(pool, consultMediaFor(cfg, lk), esc, consultAuditor{a: audit})

	pub := r.Group("/api/v1/consult")
	h := &consultHandler{svc: svc}
	pub.GET("/packages", h.listPackages)
	pub.GET("/packages/:id", h.getPackage)

	authed := r.Group("/api/v1/consult")
	authed.Use(authMW, requireUserID())
	registerConsultHandlers(authed, svc)

	log.Printf("[consult] mounted /api/v1/consult (media=%v, escrow=%v)",
		cfg.FeatureLiveKitEnabled, ledgerSvc != nil)
	return svc
}
