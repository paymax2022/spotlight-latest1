package roles

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/platform/r2"
)

const (
	maxBodyBytes = 64 << 10
	presignTTL   = 10 * time.Minute
)

var allowedUploadTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/webp": true, "application/pdf": true,
}

// api is the slice of *Service the handlers use; it lets tests inject a fake.
type api interface {
	Register(ctx context.Context, userID, role, displayName string) (*Profile, error)
	Update(ctx context.Context, userID, role string, displayName *string, details map[string]any) (*Profile, error)
	AddDocument(ctx context.Context, userID, role, kind, storageKey string) (*Profile, error)
	Submit(ctx context.Context, userID, role string) (*Profile, error)
	MyRoles(ctx context.Context, userID string) ([]Profile, error)
	ListByVerification(ctx context.Context, status string, limit, offset int) ([]Profile, error)
	Approve(ctx context.Context, adminID, profileID string) (*Profile, error)
	Reject(ctx context.Context, adminID, profileID, reason string) (*Profile, error)
	Suspend(ctx context.Context, adminID, profileID, reason string) (*Profile, error)
}

type Handler struct {
	svc       api
	presigner *r2.Presigner
}

func NewHandler(svc *Service, presigner *r2.Presigner) *Handler {
	return &Handler{svc: svc, presigner: presigner}
}

func newHandler(svc api, presigner *r2.Presigner) *Handler {
	return &Handler{svc: svc, presigner: presigner}
}

// RegisterMember mounts the caller-scoped routes on g (mount at /property/roles).
func RegisterMember(g gin.IRouter, h *Handler) {
	g.GET("", h.listMine)
	g.POST("/:role", h.register)
	g.PATCH("/:role", h.update)
	g.POST("/:role/documents/presign", h.presign)
	g.POST("/:role/documents", h.recordDocument)
	g.POST("/:role/submit", h.submit)
}

// RegisterAdmin mounts the review routes on g; every route sits behind perm.
func RegisterAdmin(g gin.IRouter, h *Handler, perm gin.HandlerFunc) {
	g.GET("", perm, h.adminList)
	g.POST("/:id/approve", perm, h.approve)
	g.POST("/:id/reject", perm, h.reject)
	g.POST("/:id/suspend", perm, h.suspend)
}

// callerID reads the authenticated user from the gin context only (never from
// the request) and normalises it to canonical lowercase UUID text.
func callerID(c *gin.Context) (string, bool) {
	raw, _ := c.Get("user_id")
	s, _ := raw.(string)
	id, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return "", false
	}
	return id.String(), true
}

func roleParam(c *gin.Context) (string, bool) {
	r := c.Param("role")
	if !ValidRole(r) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role"})
		return "", false
	}
	return r, true
}

func bind(c *gin.Context, dst any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	if err := c.ShouldBindJSON(dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body too large"})
			return false
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return false
	}
	return true
}

func writeErr(c *gin.Context, err error) {
	var inc *IncompleteError
	switch {
	case errors.As(err, &inc):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "required details missing", "code": "incomplete", "missing": inc.Missing})
	case errors.Is(err, ErrIncomplete):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "required details missing", "code": "incomplete", "missing": []string{}})
	case errors.Is(err, ErrNoDocument):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "at least one document is required", "code": "no_document"})
	case errors.Is(err, ErrInvalidRole), errors.Is(err, ErrDetailsInvalid), errors.Is(err, ErrReasonRequired), errors.Is(err, ErrForeignKey):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
	case errors.Is(err, ErrSelfReview), errors.Is(err, ErrSuspended):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBadTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "invalid verification transition"})
	default:
		log.Printf("[property/roles] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
	}
}

func (h *Handler) listMine(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	ps, err := h.svc.MyRoles(c.Request.Context(), uid)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nonNil(ps)})
}

func nonNil(ps []Profile) []Profile {
	if ps == nil {
		return []Profile{}
	}
	return ps
}

func (h *Handler) register(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	role, ok := roleParam(c)
	if !ok {
		return
	}
	var req struct {
		DisplayName string         `json:"displayName"`
		Details     map[string]any `json:"details"`
	}
	if !bind(c, &req) {
		return
	}
	p, err := h.svc.Register(c.Request.Context(), uid, role, req.DisplayName)
	if err != nil {
		writeErr(c, err)
		return
	}
	if len(req.Details) > 0 {
		if p, err = h.svc.Update(c.Request.Context(), uid, role, nil, req.Details); err != nil {
			writeErr(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) update(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	role, ok := roleParam(c)
	if !ok {
		return
	}
	var req struct {
		DisplayName *string        `json:"displayName"`
		Details     map[string]any `json:"details"`
	}
	if !bind(c, &req) {
		return
	}
	p, err := h.svc.Update(c.Request.Context(), uid, role, req.DisplayName, req.Details)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) presign(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	role, ok := roleParam(c)
	if !ok {
		return
	}
	var req struct {
		Kind        string `json:"kind"`
		ContentType string `json:"contentType"`
	}
	if !bind(c, &req) {
		return
	}
	if !documentKinds[req.Kind] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown document kind"})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	if !allowedUploadTypes[ct] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "contentType must be image/png, image/jpeg, image/webp or application/pdf"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "document uploads are not configured"})
		return
	}
	var rnd [16]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	key := DocumentKeyPrefix(uid, role) + hex.EncodeToString(rnd[:])
	url, err := h.presigner.PresignPut(key, ct, presignTTL)
	if err != nil {
		log.Printf("[property/roles] presign failed: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "document uploads are unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"uploadUrl":   url,
		"storageKey":  key,
		"contentType": ct,
		"expiresIn":   int(presignTTL.Seconds()),
		"method":      "PUT",
	})
}

func (h *Handler) recordDocument(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	role, ok := roleParam(c)
	if !ok {
		return
	}
	var req struct {
		Kind       string `json:"kind"`
		StorageKey string `json:"storageKey"`
	}
	if !bind(c, &req) {
		return
	}
	p, err := h.svc.AddDocument(c.Request.Context(), uid, role, req.Kind, req.StorageKey)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, p)
}

func (h *Handler) submit(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	role, ok := roleParam(c)
	if !ok {
		return
	}
	p, err := h.svc.Submit(c.Request.Context(), uid, role)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) adminList(c *gin.Context) {
	if _, ok := callerID(c); !ok {
		return
	}
	status := c.DefaultQuery("status", VerPending)
	limit, offset := 50, 0
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > 200 {
		limit = 200
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}
	ps, err := h.svc.ListByVerification(c.Request.Context(), status, limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nonNil(ps)})
}

func (h *Handler) approve(c *gin.Context) {
	admin, ok := callerID(c)
	if !ok {
		return
	}
	p, err := h.svc.Approve(c.Request.Context(), admin, c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) reject(c *gin.Context) {
	admin, ok := callerID(c)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if !bind(c, &req) {
		return
	}
	p, err := h.svc.Reject(c.Request.Context(), admin, c.Param("id"), req.Reason)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// suspend takes an optional {reason} body (the contract defines none).
func (h *Handler) suspend(c *gin.Context) {
	admin, ok := callerID(c)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if c.Request.ContentLength != 0 && !bind(c, &req) {
		return
	}
	p, err := h.svc.Suspend(c.Request.Context(), admin, c.Param("id"), req.Reason)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}
