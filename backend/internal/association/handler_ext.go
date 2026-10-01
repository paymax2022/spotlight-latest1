package association

import (
	"context"
	"github.com/gin-gonic/gin"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	platformWS "spotlight/backend/internal/platform/ws"
)

// Handlers for the remaining endpoint groups. Error→HTTP via errMap.

func (h *Handler) GetNotificationPrefs(c *gin.Context) {
	v, err := h.svc.GetNotificationPrefs(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) UpdateNotificationPrefs(c *gin.Context) {
	var b NotificationPrefs
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.UpdateNotificationPrefs(c.Request.Context(), ginutil.UserID(c), b)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetSecurity(c *gin.Context) {
	v, err := h.svc.GetSecuritySettings(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) UpdateSecurity(c *gin.Context) {
	var b SecuritySettings
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.UpdateSecuritySettings(c.Request.Context(), ginutil.UserID(c), b)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetPreferences(c *gin.Context) {
	v, err := h.svc.GetPreferences(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) UpdatePreferences(c *gin.Context) {
	var b Preferences
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.UpdatePreferences(c.Request.Context(), ginutil.UserID(c), b)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetDevices(c *gin.Context) {
	v, err := h.svc.GetDevices(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) RevokeDevice(c *gin.Context) {
	if err := h.svc.RevokeDevice(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) GetFaqs(c *gin.Context) {
	v, err := h.svc.GetFaqs(c.Request.Context())
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) ListTickets(c *gin.Context) {
	v, err := h.svc.GetTickets(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetTicket(c *gin.Context) {
	v, err := h.svc.GetTicket(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) CreateTicket(c *gin.Context) {
	var b CreateTicketInput
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.CreateTicket(c.Request.Context(), ginutil.UserID(c), b)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) ReplyTicket(c *gin.Context) {
	var b struct {
		Body string `json:"body" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.ReplyTicket(c.Request.Context(), ginutil.UserID(c), c.Param("id"), b.Body)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, m)
}

// ServeWS upgrades the connection to the caller's own realtime stream. The
// member is resolved from RequireAuthContext (Bearer JWT already validated);
// hub.ServeHTTP registers the connection keyed by user id, so a message posted
// by any member of a thread fans out to every other member allowed to read it.
// Replaces Supabase Realtime for group chat: the same open-source WebSocket
// stack (platform/ws) the food, mobility and doctor streams already use, so chat
// delivery no longer depends on a hosted realtime service.
func (h *Handler) ServeWS(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime not configured"})
		return
	}
	// On success the connection is hijacked; an error here means the upgrade
	// failed before writing, so there is nothing to send a second response for.
	_ = h.hub.ServeHTTP(c.Writer, c.Request, uid)
}

// pushChatMessage fans a committed message out to the thread's audience, minus
// the sender (who already has it from the POST response). Best-effort: the write
// is durable by the time this runs, so a push failure must never change the
// response.
// The audience comes from ChatThreadAudience — the SAME scope gate the read
// paths apply — so an ordinary member is never pushed the body of an executive
// or committee message they could not fetch.
func (h *Handler) pushChatMessage(ctx context.Context, threadID, senderID string, m *ChatMessage) {
	if h.hub == nil {
		return
	}
	audience, err := h.svc.ChatThreadAudience(ctx, threadID)
	if err != nil {
		return
	}
	// SendChatMessage stamps `mine: true`, which is correct for the POST response
	// but wrong for every recipient of this push. Copy rather than mutate — the
	// response holds the same pointer. (The client treats the frame as a signal
	// and re-reads through the API, which filters `mine` per caller anyway.)
	payload := *m
	payload.Mine = false
	for _, uid := range audience {
		if uid == senderID {
			continue
		}
		h.hub.SendToUser(uid, platformWS.Message{Type: "chat.message", Payload: payload})
	}
}

func (h *Handler) ListChatThreads(c *gin.Context) {
	v, err := h.svc.GetChatThreads(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetChatThread(c *gin.Context) {
	v, err := h.svc.GetChatThread(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) SendChatMessage(c *gin.Context) {
	var b struct {
		Body string `json:"body" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.SendChatMessage(c.Request.Context(), ginutil.UserID(c), c.Param("id"), b.Body)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	// The row is committed; tell the thread's other members now rather than
	// leaving them to discover it on their next fetch.
	h.pushChatMessage(c.Request.Context(), c.Param("id"), ginutil.UserID(c), m)
	c.JSON(http.StatusCreated, m)
}

// POST /associations/chat/threads/:id/mute — persist mute preference.
func (h *Handler) MuteChatThread(c *gin.Context) {
	var b struct {
		Muted bool `json:"muted"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.MuteThread(c.Request.Context(), ginutil.UserID(c), c.Param("id"), b.Muted); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ListAiNotes(c *gin.Context) {
	v, err := h.svc.GetAiNotes(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetAiNote(c *gin.Context) {
	v, err := h.svc.GetAiNote(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetAiNoteStatus(c *gin.Context) {
	status, err := h.svc.GetAiNoteStatus(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyStatus: status})
}

func (h *Handler) CreateAiNote(c *gin.Context) {
	var b CreateAiNoteInput
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, status, err := h.svc.CreateAiNote(c.Request.Context(), ginutil.UserID(c), b)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"id": id, keyStatus: status})
}

func (h *Handler) ApproveAiNote(c *gin.Context) {
	if err := h.svc.SetAiNoteStatus(c.Request.Context(), ginutil.UserID(c), c.Param("id"), "APPROVED", "MINUTES_APPROVE"); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) PublishAiNote(c *gin.Context) {
	if err := h.svc.SetAiNoteStatus(c.Request.Context(), ginutil.UserID(c), c.Param("id"), "PUBLISHED", "MINUTES_PUBLISH"); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ConvertActionItem(c *gin.Context) {
	taskID, err := h.svc.ConvertActionItem(c.Request.Context(), ginutil.UserID(c), c.Param("id"), c.Param("itemId"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"taskId": taskID})
}

func (h *Handler) ValidateInvite(c *gin.Context) { h.validateCode(c, "INVITE") }

func (h *Handler) ValidateAccessCode(c *gin.Context) { h.validateCode(c, "ACCESS") }

func (h *Handler) validateCode(c *gin.Context, kind string) {
	var b CodeRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.ValidateCode(c.Request.Context(), kind, b.Code)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) SubmitApplication(c *gin.Context) {
	var b JoinDraft
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SubmitApplication(c.Request.Context(), ginutil.UserID(c), b)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ImportPreview(c *gin.Context) {
	// Parse the uploaded CSV (multipart form field "file"). org_id is taken from
	// the query param when supplied, otherwise resolved from the caller's primary
	// membership inside the service. Mirrors BulkImportMembers' parsing.
	orgID := c.Query("org_id")
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "multipart file 'file' required"})
		return
	}
	defer file.Close()
	fileName := ""
	if header != nil {
		fileName = header.Filename
	}
	v, err := h.svc.ImportPreview(c.Request.Context(), ginutil.UserID(c), orgID, fileName, file)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) ConfirmImport(c *gin.Context) {
	var b ImportConfirmRequest
	// batchId is required, so a bind error must not be swallowed the way it was
	// before — the old code ignored the body entirely and confirmed nothing.
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.ConfirmImport(c.Request.Context(), ginutil.UserID(c), b.BatchID, b.SendInvites)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PublishOrganisation(c *gin.Context) {
	var b OrgDraft
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b.IdempotencyKey = ginutil.IdempotencyKey(c)
	res, err := h.svc.PublishOrganisation(c.Request.Context(), ginutil.UserID(c), b)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// Election endpoints. Officer actions are org-scoped inside the service
// (requireElectionOfficer); voter actions are fail-closed on eligibility + window.

func (h *Handler) ListElections(c *gin.Context) {
	v, err := h.svc.ListElections(c.Request.Context(), ginutil.UserID(c), c.Query("org_id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetElection(c *gin.Context) {
	v, err := h.svc.GetElection(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) CreateElection(c *gin.Context) {
	var in CreateElectionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.CreateElection(c.Request.Context(), ginutil.UserID(c), c.Query("org_id"), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) AddElectionCandidate(c *gin.Context) {
	var in AddCandidateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.AddCandidate(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) OpenElection(c *gin.Context) {
	if err := h.svc.OpenElection(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) CloseElection(c *gin.Context) {
	if err := h.svc.CloseElection(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) PublishElectionResults(c *gin.Context) {
	res, err := h.svc.PublishResults(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) HandoverElection(c *gin.Context) {
	res, err := h.svc.HandoverElection(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetElectionTally(c *gin.Context) {
	res, err := h.svc.Tally(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CastVote(c *gin.Context) {
	var in CastVoteInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	receipt, err := h.svc.CastVote(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, receipt)
}
