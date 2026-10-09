package connectconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service reads backend-owned Connect config from public.connect_config.
// It is read-only here (Phase 0); admin writes arrive in a later slice.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// PublicConfig returns the key→value map of rows safe to expose to mobile
// (visibility = 'public'). This is what GET /api/v1/connect/config serves.
func (s *Service) PublicConfig(ctx context.Context) (map[string]json.RawMessage, error) {
	const q = `SELECT key, value FROM connect_config WHERE visibility = 'public' ORDER BY key`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("connect: query public config: %w", err)
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var key string
		var value []byte
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("connect: scan config: %w", err)
		}
		out[key] = json.RawMessage(value)
	}
	return out, rows.Err()
}

// AllConfig returns every config entry (public + internal) for admin views.
// Authorization is enforced at the route layer (connect.config.view).
func (s *Service) AllConfig(ctx context.Context) ([]Entry, error) {
	const q = `SELECT key, value, scope, visibility, COALESCE(description,'')
	           FROM connect_config ORDER BY key`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("connect: query all config: %w", err)
	}
	defer rows.Close()

	var out []Entry
	for rows.Next() {
		var e Entry
		var value []byte
		if err := rows.Scan(&e.Key, &value, &e.Scope, &e.Visibility, &e.Description); err != nil {
			return nil, fmt.Errorf("connect: scan config: %w", err)
		}
		e.Value = json.RawMessage(value)
		out = append(out, e)
	}
	return out, rows.Err()
}

// Entry is a single backend-owned config row.
type Entry struct {
	Key         string          `json:"key"`
	Value       json.RawMessage `json:"value"`
	Scope       string          `json:"scope"`
	Visibility  string          `json:"visibility"`
	Description string          `json:"description,omitempty"`
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Health is an unauthenticated module liveness probe.
func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "module": "connect"})
}

// Config serves the backend-owned, mobile-readable config (public rows only).
func (h *Handler) Config(c *gin.Context) {
	cfg, err := h.svc.PublicConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cfg})
}

// AdminConfig serves all config entries (public + internal) for admin tooling.
// Route layer gates this behind the connect.config.view permission.
func (h *Handler) AdminConfig(c *gin.Context) {
	entries, err := h.svc.AllConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}
