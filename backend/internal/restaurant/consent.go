package restaurant

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// FOOD-UAT-H-001 — marketing / promo consent ledger (user_consents).
//
// Append-only: granting or withdrawing inserts a new row and the newest row per
// (user_id, kind) is the effective state. No consent row ⇒ NOT consented
// (opt-in, fail-closed). There was no generic consent store before this (only
// referral/compliance's referral-specific one), so it lives with the Food module
// for now; the table itself is kind-keyed and reusable.

const (
	ConsentMarketing = "marketing"
	ConsentPromo     = "promo"

	consentGranted   = "granted"
	consentWithdrawn = "withdrawn"
)

var (
	ErrConsentKindInvalid = errors.New("restaurant: invalid consent kind")
	consentKindRe         = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
)

// ConsentMeta is the provenance stored with a consent row.
type ConsentMeta struct {
	Source    string // e.g. "food_checkout"
	UserAgent string
	IP        string // hashed before storage; never persisted raw
}

func hashIP(ip string) string {
	if ip == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ip))
	return hex.EncodeToString(sum[:])
}

func (s *Service) writeConsent(ctx context.Context, userID, kind, status string, m ConsentMeta) error {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if !consentKindRe.MatchString(kind) {
		return ErrConsentKindInvalid
	}
	if userID == "" {
		return errors.New("restaurant: consent requires a user")
	}
	_, err := s.db.Exec(ctx, `INSERT INTO user_consents (user_id, kind, status, source, user_agent, ip_hash)
	  VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''))`,
		userID, kind, status, m.Source, m.UserAgent, hashIP(m.IP))
	if err != nil {
		return fmt.Errorf("restaurant: write consent: %w", err)
	}
	if s.audit != nil {
		s.audit.LogAction(userID, userID, "consent."+status, "restaurant", "user_consent", kind,
			nil, map[string]any{"kind": kind, "source": m.Source}, "", m.UserAgent, "info")
	}
	return nil
}

// RecordConsent records that the user granted consent for kind.
func (s *Service) RecordConsent(ctx context.Context, userID, kind string, m ConsentMeta) error {
	return s.writeConsent(ctx, userID, kind, consentGranted, m)
}

// WithdrawConsent records that the user withdrew consent for kind.
func (s *Service) WithdrawConsent(ctx context.Context, userID, kind string, m ConsentMeta) error {
	return s.writeConsent(ctx, userID, kind, consentWithdrawn, m)
}

// HasActiveConsent is true only when the newest row for (user, kind) is 'granted'.
func (s *Service) HasActiveConsent(ctx context.Context, userID, kind string) (bool, error) {
	var status string
	err := s.db.QueryRow(ctx, `SELECT status FROM user_consents
	  WHERE user_id=$1 AND kind=$2 ORDER BY created_at DESC, id DESC LIMIT 1`,
		userID, strings.ToLower(strings.TrimSpace(kind))).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("restaurant: read consent: %w", err)
	}
	return status == consentGranted, nil
}

// MarketingSendAllowed is the gate a caller MUST consult before sending a
// marketing push / promo notification. It fails closed: a lookup error means
// "do not send". Transactional notices (order status, receipts) are not marketing
// and must not go through this.
func (s *Service) MarketingSendAllowed(ctx context.Context, userID string) bool {
	ok, err := s.HasActiveConsent(ctx, userID, ConsentMarketing)
	return err == nil && ok
}

type consentBody struct {
	Kind   string `json:"kind" binding:"required"`
	Source string `json:"source"`
}

// RecordConsent → POST /api/finance/restaurant/consents {kind, source}
func (h *Handler) RecordConsent(c *gin.Context) {
	var b consentBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	h.consentWrite(c, b.Kind, b.Source, true)
}

// WithdrawConsent → DELETE /api/finance/restaurant/consents/:kind
func (h *Handler) WithdrawConsent(c *gin.Context) {
	h.consentWrite(c, c.Param("kind"), "", false)
}

func (h *Handler) consentWrite(c *gin.Context, kind, source string, grant bool) {
	m := ConsentMeta{Source: source, UserAgent: c.Request.UserAgent(), IP: c.ClientIP()}
	var err error
	if grant {
		err = h.svc.RecordConsent(c.Request.Context(), ginutil.UserID(c), kind, m)
	} else {
		err = h.svc.WithdrawConsent(c.Request.Context(), ginutil.UserID(c), kind, m)
	}
	if err != nil {
		st := http.StatusInternalServerError
		if errors.Is(err, ErrConsentKindInvalid) {
			st = http.StatusBadRequest
		}
		c.JSON(st, gin.H{keyError: httperr.Msg(c, st, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kind": strings.ToLower(strings.TrimSpace(kind)), "granted": grant})
}

// GetConsent → GET /api/finance/restaurant/consents/:kind
func (h *Handler) GetConsent(c *gin.Context) {
	ok, err := h.svc.HasActiveConsent(c.Request.Context(), ginutil.UserID(c), c.Param("kind"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kind": c.Param("kind"), "granted": ok})
}
