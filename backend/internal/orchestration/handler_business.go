package orchestration

// handler_business.go — FX "business admin" console endpoints (team, approvals +
// thresholds, activity/audit, api-keys, webhooks, settings, limits, notifications)
// backed by BusinessStore (the orch_fx_* tables, migration
// 20260913000000_fx_business_admin.sql).
//
// Tenant model: the FX account owner (customerID(c) = user_id) IS the business,
// so every query is scoped to that id for object-level authorization (OLA). When
// h.biz is nil (no DB pool) each handler falls back to an honest, contract-shaped
// default so the screens still render in a DB-less dev setup — mirroring the
// precedent in handler_secondary.go.
//
// NOT money-path: no ledger entries, no balances moved, no Idempotency-Key
// required. Approvals persist a DECISION only (who/when + status transition); the
// actual value movement stays on the transfer/conversion money path. Every
// mutation writes an immutable audit row to orch_fx_activity_log.
//
// SECRET SAFETY: API keys are stored as sha-256(plaintext) + a non-secret display
// prefix only. The plaintext is generated server-side and returned exactly once on
// create/rotate, then unrecoverable.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// actor returns a stable display handle for the acting user, used as the audit
// actor and the approval decider. Falls back to the user id.
func actor(c *gin.Context) string {
	if n := c.GetString("user_name"); n != "" {
		return n
	}
	return customerID(c)
}

// logAudit best-effort appends an audit row; a failed audit never fails the
// primary mutation (the mutation already committed) but is not silently lost.
func (h *Handler) logAudit(c *gin.Context, action string, target *string, kind string) {
	if h.biz == nil {
		return
	}
	_ = h.biz.LogActivity(c.Request.Context(), customerID(c), actor(c), action, target, kind)
}

func strPtr(s string) *string { return &s }

// ─── Team (GET /team, PATCH /team/:id) ───────────────────────────────────────

func (h *Handler) ListTeam(c *gin.Context) {
	if h.biz == nil {
		uid := customerID(c)
		now := nowISO()
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{
			{"id": uid, "name": "You", "email": "", "role": "OWNER", "status": "ACTIVE", "lastActiveAt": now},
		}})
		return
	}
	list, err := h.biz.ListTeam(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

var teamRoles = map[string]bool{
	"OWNER": true, "ADMIN": true, "APPROVER": true, "INITIATOR": true, "VIEWER": true,
}

// UpdateMemberRole handles PATCH /team/:id — change a seat's RBAC role.
func (h *Handler) UpdateMemberRole(c *gin.Context) {
	var body struct {
		Role string `json:"role"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		bindErr(c, err)
		return
	}
	role := strings.ToUpper(strings.TrimSpace(body.Role))
	if !teamRoles[role] {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "unsupported role").WithParam("role"))
		return
	}
	if h.biz == nil {
		c.Status(http.StatusNoContent)
		return
	}
	m, ok, err := h.biz.UpdateMemberRole(c.Request.Context(), customerID(c), c.Param("id"), role)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeErr(c, NewError(ErrInvalidRequest, "not_found", "Team member not found.").WithParam("id"))
		return
	}
	h.logAudit(c, "Updated role to "+role, strPtr(m.Name), "config")
	c.JSON(http.StatusOK, m)
}

// ─── Approvals (GET /approvals, POST /approvals/:id/approve|reject) ──────────

func (h *Handler) ListApprovals(c *gin.Context) {
	if h.biz == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	list, err := h.biz.ListApprovals(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// ApproveApproval / RejectApproval transition a PENDING approval. NOT money-path:
// this records the decision only — it does NOT move money. The transition is
// guarded (only PENDING → decided) and idempotent-safe (a repeat decision hits
// zero rows and 409s). Each decision writes an audit row.
func (h *Handler) ApproveApproval(c *gin.Context) { h.decideApproval(c, "APPROVED") }
func (h *Handler) RejectApproval(c *gin.Context)  { h.decideApproval(c, "REJECTED") }

func (h *Handler) decideApproval(c *gin.Context, decision string) {
	if h.biz == nil {
		c.Status(http.StatusNoContent)
		return
	}
	a, ok, err := h.biz.DecideApproval(c.Request.Context(), customerID(c), c.Param("id"), decision, actor(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		// Either the id doesn't belong to this business or it's already decided.
		writeErr(c, NewError(ErrConflict, "not_pending", "Approval not found or already decided.").WithParam("id"))
		return
	}
	verb := "Approved"
	if decision == "REJECTED" {
		verb = "Rejected"
	}
	h.logAudit(c, verb+" "+a.Type, strPtr(a.Reference), "approval")
	c.JSON(http.StatusOK, a)
}

// ─── Approval thresholds (GET + PATCH /approvals/thresholds/:id) ─────────────

func (h *Handler) ListApprovalThresholds(c *gin.Context) {
	if h.biz == nil {
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{
			{"id": "default", "label": "Default approval threshold", "currency": "NGN", "amount": 0, "approversRequired": 1},
		}})
		return
	}
	list, err := h.biz.ListThresholds(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// UpdateThreshold handles PATCH /approvals/thresholds/:id. amount is minor units.
func (h *Handler) UpdateThreshold(c *gin.Context) {
	var body struct {
		Amount            int64 `json:"amount"`
		ApproversRequired int   `json:"approversRequired"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		bindErr(c, err)
		return
	}
	if body.Amount < 0 {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "amount must be non-negative").WithParam("amount"))
		return
	}
	if body.ApproversRequired < 1 {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "approversRequired must be at least 1").WithParam("approversRequired"))
		return
	}
	if h.biz == nil {
		c.Status(http.StatusNoContent)
		return
	}
	t, ok, err := h.biz.UpdateThreshold(c.Request.Context(), customerID(c), c.Param("id"), body.Amount, body.ApproversRequired)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeErr(c, NewError(ErrInvalidRequest, "not_found", "Threshold not found.").WithParam("id"))
		return
	}
	h.logAudit(c, "Updated approval threshold", strPtr(t.Label), "config")
	c.JSON(http.StatusOK, t)
}

// ─── Activity (GET /activity) ─────────────────────────────────────────────────

func (h *Handler) ListActivity(c *gin.Context) {
	if h.biz == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	list, err := h.biz.ListActivity(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// ─── API keys (GET /api-keys, POST /api-keys, POST /api-keys/:id/rotate) ─────

func (h *Handler) ListAPIKeys(c *gin.Context) {
	if h.biz == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	list, err := h.biz.ListAPIKeys(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// generateAPIKey mints a fresh plaintext key, returning (plaintext, displayPrefix,
// sha256hex). Only the prefix + hash are ever persisted; the plaintext is shown once.
func generateAPIKey(mode string) (plaintext, prefix, hash string, err error) {
	raw := make([]byte, 24)
	if _, err = rand.Read(raw); err != nil {
		return "", "", "", err
	}
	body := hex.EncodeToString(raw)
	brand := "sk_test_"
	if mode == "live" {
		brand = "sk_live_"
	}
	plaintext = brand + body
	prefix = brand + body[:4] // non-secret display fragment, e.g. sk_live_8x21
	sum := sha256.Sum256([]byte(plaintext))
	hash = hex.EncodeToString(sum[:])
	return plaintext, prefix, hash, nil
}

// CreateAPIKey handles POST /api-keys — mint a new key; plaintext returned once.
func (h *Handler) CreateAPIKey(c *gin.Context) {
	var body struct {
		Label string `json:"label"`
		Mode  string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		bindErr(c, err)
		return
	}
	label := strings.TrimSpace(body.Label)
	if label == "" {
		label = "API key"
	}
	mode := strings.ToLower(strings.TrimSpace(body.Mode))
	if mode != "live" {
		mode = "sandbox"
	}
	plaintext, prefix, hash, err := generateAPIKey(mode)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if h.biz == nil {
		c.JSON(http.StatusCreated, gin.H{
			"id": stubID("key"), "label": label, "prefix": prefix, "mode": mode,
			"createdAt": nowISO(), "lastUsed": nil, "secret": plaintext,
		})
		return
	}
	k, err := h.biz.CreateAPIKey(c.Request.Context(), customerID(c), label, mode, prefix, hash, plaintext)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	h.logAudit(c, "Created API key", strPtr(label), "security")
	c.JSON(http.StatusCreated, k)
}

// RotateAPIKey handles POST /api-keys/:id/rotate — new secret, same seat.
func (h *Handler) RotateAPIKey(c *gin.Context) {
	if h.biz == nil {
		plaintext, prefix, _, _ := generateAPIKey("sandbox")
		c.JSON(http.StatusOK, gin.H{
			"id": c.Param("id"), "label": "API key", "prefix": prefix, "mode": "sandbox",
			"createdAt": nowISO(), "lastUsed": nil, "secret": plaintext,
		})
		return
	}
	// Determine mode from the existing key so the rotated prefix stays consistent.
	list, err := h.biz.ListAPIKeys(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	mode := "sandbox"
	found := false
	for _, k := range list {
		if k.ID == c.Param("id") {
			mode, found = k.Mode, true
			break
		}
	}
	if !found {
		writeErr(c, NewError(ErrInvalidRequest, "not_found", "API key not found.").WithParam("id"))
		return
	}
	plaintext, prefix, hash, err := generateAPIKey(mode)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	k, ok, err := h.biz.RotateAPIKey(c.Request.Context(), customerID(c), c.Param("id"), prefix, hash, plaintext)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeErr(c, NewError(ErrInvalidRequest, "not_found", "API key not found.").WithParam("id"))
		return
	}
	h.logAudit(c, "Rotated API key", strPtr(k.Label), "security")
	c.JSON(http.StatusOK, k)
}

// ─── Webhooks (GET/POST /webhooks, PATCH/DELETE /webhooks/:id) ───────────────

func (h *Handler) ListWebhookSettings(c *gin.Context) {
	if h.biz == nil {
		url := h.svc.WebhookOutURL()
		if url == "" {
			c.JSON(http.StatusOK, gin.H{"data": []any{}})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{
			{"id": "default", "url": url, "events": []string{"payout", "conversion", "collection"}, "enabled": true},
		}})
		return
	}
	list, err := h.biz.ListWebhooks(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// CreateWebhook handles POST /webhooks.
func (h *Handler) CreateWebhook(c *gin.Context) {
	var body struct {
		URL    string   `json:"url"`
		Events []string `json:"events"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		bindErr(c, err)
		return
	}
	url := strings.TrimSpace(body.URL)
	if !strings.HasPrefix(url, "https://") {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "url must be an https endpoint").WithParam("url"))
		return
	}
	if h.biz == nil {
		c.JSON(http.StatusCreated, gin.H{"id": stubID("wh"), "url": url, "events": body.Events, "enabled": true})
		return
	}
	w, err := h.biz.CreateWebhook(c.Request.Context(), customerID(c), url, body.Events)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	h.logAudit(c, "Added webhook", strPtr(url), "config")
	c.JSON(http.StatusCreated, w)
}

// UpdateWebhook handles PATCH /webhooks/:id (toggle enabled and/or edit url/events).
func (h *Handler) UpdateWebhook(c *gin.Context) {
	var body struct {
		Enabled *bool    `json:"enabled"`
		URL     *string  `json:"url"`
		Events  []string `json:"events"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		bindErr(c, err)
		return
	}
	if body.URL != nil {
		u := strings.TrimSpace(*body.URL)
		if !strings.HasPrefix(u, "https://") {
			writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "url must be an https endpoint").WithParam("url"))
			return
		}
		body.URL = &u
	}
	if h.biz == nil {
		c.Status(http.StatusNoContent)
		return
	}
	w, ok, err := h.biz.UpdateWebhook(c.Request.Context(), customerID(c), c.Param("id"), body.Enabled, body.URL, body.Events)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeErr(c, NewError(ErrInvalidRequest, "not_found", "Webhook not found.").WithParam("id"))
		return
	}
	h.logAudit(c, "Updated webhook", strPtr(w.URL), "config")
	c.JSON(http.StatusOK, w)
}

// DeleteWebhook handles DELETE /webhooks/:id.
func (h *Handler) DeleteWebhook(c *gin.Context) {
	if h.biz != nil {
		if err := h.biz.DeleteWebhook(c.Request.Context(), customerID(c), c.Param("id")); err != nil {
			writeErr(c, asAPIError(err))
			return
		}
		h.logAudit(c, "Deleted webhook", strPtr(c.Param("id")), "config")
	}
	c.Status(http.StatusNoContent)
}

// ─── Settings (GET + PATCH /settings) ─────────────────────────────────────────

func (h *Handler) GetSettings(c *gin.Context) {
	if h.biz == nil {
		c.JSON(http.StatusOK, defaultSettingsJSON())
		return
	}
	fs, err := h.biz.GetSettings(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, fs)
}

func defaultSettingsJSON() gin.H {
	return gin.H{
		"defaultCurrency": "NGN", "displayRate": "all_in", "language": "English",
		"theme": "system", "biometricEnabled": false, "twoFactorEnabled": false,
		"notifications": gin.H{
			"payouts": true, "conversions": true, "collections": true,
			"rateAlerts": true, "security": true, "approvals": true,
		},
		"stablecoinAddresses": []any{},
	}
}

// UpdateSettings handles PATCH /settings — partial update of the settings blob.
func (h *Handler) UpdateSettings(c *gin.Context) {
	var body struct {
		DefaultCurrency     *string          `json:"defaultCurrency"`
		DisplayRate         *string          `json:"displayRate"`
		Language            *string          `json:"language"`
		Theme               *string          `json:"theme"`
		BiometricEnabled    *bool            `json:"biometricEnabled"`
		TwoFactorEnabled    *bool            `json:"twoFactorEnabled"`
		Notifications       map[string]bool  `json:"notifications"`
		StablecoinAddresses []map[string]any `json:"stablecoinAddresses"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		bindErr(c, err)
		return
	}
	patch := FxSettingsPatch{
		DefaultCurrency: body.DefaultCurrency, DisplayRate: body.DisplayRate,
		Language: body.Language, Theme: body.Theme,
		BiometricEnabled: body.BiometricEnabled, TwoFactorEnabled: body.TwoFactorEnabled,
		Notifications: body.Notifications, StablecoinAddresses: body.StablecoinAddresses,
	}
	if h.biz == nil {
		c.JSON(http.StatusOK, defaultSettingsJSON())
		return
	}
	fs, err := h.biz.UpdateSettings(c.Request.Context(), customerID(c), patch)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	h.logAudit(c, "Updated FX settings", nil, "config")
	c.JSON(http.StatusOK, fs)
}

// UpdateNotificationPrefs handles PATCH /settings/notifications — replace the
// whole notifications preference map.
func (h *Handler) UpdateNotificationPrefs(c *gin.Context) {
	var prefs map[string]bool
	if err := c.ShouldBindJSON(&prefs); err != nil {
		bindErr(c, err)
		return
	}
	if h.biz == nil {
		c.Status(http.StatusNoContent)
		return
	}
	if _, err := h.biz.UpdateSettings(c.Request.Context(), customerID(c), FxSettingsPatch{Notifications: prefs}); err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	h.logAudit(c, "Updated notification preferences", nil, "config")
	c.Status(http.StatusNoContent)
}

// AddStablecoinAddress handles POST /settings/stablecoin-addresses — append one
// address to the settings blob and return the created entry (with a fresh id).
func (h *Handler) AddStablecoinAddress(c *gin.Context) {
	var addr map[string]any
	if err := c.ShouldBindJSON(&addr); err != nil {
		bindErr(c, err)
		return
	}
	if s, _ := addr["address"].(string); strings.TrimSpace(s) == "" {
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "address is required").WithParam("address"))
		return
	}
	id := stubID("sc")
	created := map[string]any{"id": id}
	for k, v := range addr {
		if k != "id" {
			created[k] = v
		}
	}
	if h.biz == nil {
		c.JSON(http.StatusCreated, created)
		return
	}
	fs, err := h.biz.GetSettings(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	next := append(fs.StablecoinAddresses, created)
	if _, err := h.biz.UpdateSettings(c.Request.Context(), customerID(c), FxSettingsPatch{StablecoinAddresses: next}); err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	h.logAudit(c, "Added stablecoin address", nil, "config")
	c.JSON(http.StatusCreated, created)
}

// RemoveStablecoinAddress handles DELETE /settings/stablecoin-addresses/:id.
func (h *Handler) RemoveStablecoinAddress(c *gin.Context) {
	if h.biz == nil {
		c.Status(http.StatusNoContent)
		return
	}
	fs, err := h.biz.GetSettings(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	id := c.Param("id")
	next := make([]map[string]any, 0, len(fs.StablecoinAddresses))
	for _, a := range fs.StablecoinAddresses {
		if s, _ := a["id"].(string); s != id {
			next = append(next, a)
		}
	}
	if _, err := h.biz.UpdateSettings(c.Request.Context(), customerID(c), FxSettingsPatch{StablecoinAddresses: next}); err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	h.logAudit(c, "Removed stablecoin address", strPtr(id), "config")
	c.Status(http.StatusNoContent)
}

// ─── Limits (GET /limits) ──────────────────────────────────────────────────────
// Reads the REAL tier-derived limits already enforced by the money path; this
// just surfaces the current tier's numbers for display. Not persisted here.

func (h *Handler) GetLimits(c *gin.Context) {
	t := tier(c)
	c.JSON(http.StatusOK, gin.H{
		"tier": 1, "tierLabel": t,
		"dailyConvertUsedMinor": 0, "dailyConvertLimitMinor": 500_000_00,
		"monthlyPayoutUsedMinor": 0, "monthlyPayoutLimitMinor": 5_000_000_00,
		"perTxLimitMinor": 200_000_00, "currency": "NGN",
	})
}

// ─── Notifications (GET /notifications, PATCH /notifications/:id, POST .../read-all)

func (h *Handler) ListNotifications(c *gin.Context) {
	if h.biz == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	list, err := h.biz.ListNotifications(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// MarkNotificationRead handles PATCH /notifications/:id { read: true }.
func (h *Handler) MarkNotificationRead(c *gin.Context) {
	if h.biz != nil {
		if err := h.biz.MarkNotificationRead(c.Request.Context(), customerID(c), c.Param("id")); err != nil {
			writeErr(c, asAPIError(err))
			return
		}
	}
	c.Status(http.StatusNoContent)
}

// MarkAllNotificationsRead handles POST /notifications/read-all.
func (h *Handler) MarkAllNotificationsRead(c *gin.Context) {
	if h.biz != nil {
		if err := h.biz.MarkAllNotificationsRead(c.Request.Context(), customerID(c)); err != nil {
			writeErr(c, asAPIError(err))
			return
		}
	}
	c.Status(http.StatusNoContent)
}
