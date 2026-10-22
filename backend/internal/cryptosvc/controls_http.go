package cryptosvc

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// RegisterControlRoutes mounts GET /status on member (any signed-in customer: the app shows the
// banner and disables paused actions) and GET/PUT /controls on admin. The caller applies the
// auth and the admin permission. Independent of the swap pipeline: the controls also gate the
// legacy rail.
func RegisterControlRoutes(member, admin *gin.RouterGroup, store ControlsStore) {
	h := &controlsHandler{store: store}
	if member != nil {
		member.GET("/status", h.status)
	}
	if admin != nil {
		admin.GET("/controls", h.get)
		admin.PUT("/controls", h.put)
	}
}

type controlsHandler struct{ store ControlsStore }

func controlsView(v VersionedControls) gin.H {
	c := v.Controls.normalised()
	if c.DisabledAssets == nil {
		c.DisabledAssets = []string{}
	}
	out := gin.H{
		"version": v.Version, "trading_paused": c.TradingPaused, "withdrawals_paused": c.WithdrawalsPaused,
		"disabled_assets": c.DisabledAssets, "max_quote_kobo": c.QuoteLimitKobo(), "banner": c.Banner,
		"reason": v.Reason, "created_by": v.CreatedBy,
	}
	if !v.CreatedAt.IsZero() {
		out["created_at"] = v.CreatedAt.UTC().Format(time.RFC3339)
	}
	return out
}

// status GET /crypto/status — the customer-facing operational state. Unreadable controls are a
// 503, never "all open".
func (h *controlsHandler) status(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	v, err := h.store.Current(c.Request.Context())
	if err != nil {
		log.Printf("[crypto] controls unreadable: %v", err)
		fail(c, http.StatusServiceUnavailable, "status_unavailable")
		return
	}
	ctl := v.Controls.normalised()
	if ctl.DisabledAssets == nil {
		ctl.DisabledAssets = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": gin.H{
		"trading_paused": ctl.TradingPaused, "withdrawals_paused": ctl.WithdrawalsPaused,
		"disabled_assets": ctl.DisabledAssets, "max_quote_kobo": ctl.QuoteLimitKobo(), "banner": ctl.Banner,
	}})
}

func (h *controlsHandler) get(c *gin.Context) {
	ctx := c.Request.Context()
	cur, err := h.store.Current(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	hist, err := h.store.History(ctx, 50)
	if err != nil {
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	rows := make([]gin.H, 0, len(hist))
	for _, v := range hist {
		rows = append(rows, controlsView(v))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "current": controlsView(cur), "ceiling_kobo": MaxQuoteKobo, "history": rows})
}

// put PUT /admin/crypto/controls — replace the operational state with a new version. Needs an
// Idempotency-Key, the version the editor read (409 if stale) and a reason. Audited atomically.
func (h *controlsHandler) put(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	if !idemKeyRe.MatchString(key) {
		fail(c, http.StatusBadRequest, "invalid_idempotency_key")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBytes)
	var body struct {
		ExpectedVersion   *int64   `json:"expected_version"`
		TradingPaused     bool     `json:"trading_paused"`
		WithdrawalsPaused bool     `json:"withdrawals_paused"`
		DisabledAssets    []string `json:"disabled_assets"`
		MaxQuoteKobo      int64    `json:"max_quote_kobo"`
		Banner            *Banner  `json:"banner"`
		Reason            string   `json:"reason"`
	}
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || body.ExpectedVersion == nil || dec.More() {
		fail(c, http.StatusBadRequest, "invalid_body")
		return
	}
	in := ControlsInput{
		Controls: Controls{TradingPaused: body.TradingPaused, WithdrawalsPaused: body.WithdrawalsPaused,
			DisabledAssets: body.DisabledAssets, MaxQuoteKobo: body.MaxQuoteKobo, Banner: body.Banner},
		Reason: body.Reason, Actor: ginutil.UserID(c), IdempotencyKey: key, ExpectedVersion: *body.ExpectedVersion,
	}
	if err := in.Validate(); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid_controls", "detail": err.Error()})
		return
	}
	ch, err := h.store.Append(c.Request.Context(), in)
	switch {
	case errors.Is(err, ErrControlsVersionConflict):
		fail(c, http.StatusConflict, "version_conflict")
		return
	case errors.Is(err, ErrControlsIdempotencyConflict):
		fail(c, http.StatusConflict, "idempotency_conflict")
		return
	case errors.Is(err, ErrControlsInput):
		fail(c, http.StatusBadRequest, "invalid_controls")
		return
	case err != nil:
		log.Printf("[crypto] controls update failed: %v", err)
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "created": ch.Created, "current": controlsView(ch.New)})
}
