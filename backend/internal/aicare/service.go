package aicare

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

// AIProvider is a minimal interface for the AI reply backend.
// In production, swap in an Anthropic or OpenAI client.
type AIProvider interface {
	Reply(ctx context.Context, history []Message, userMessage string) (string, error)
}

// Service manages AI customer care sessions and message routing.
type Service struct {
	db *pgxpool.Pool
	ai AIProvider
}

func NewService(db *pgxpool.Pool, ai AIProvider) *Service {
	return &Service{db: db, ai: ai}
}

// CreateSession opens a new support session for a user.
func (s *Service) CreateSession(ctx context.Context, userID string, req CreateSessionRequest) (*Session, error) {
	sess := &Session{
		ID:        uuid.New().String(),
		UserID:    userID,
		Status:    SessionOpen,
		Topic:     req.Topic,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	const q = `INSERT INTO support_sessions (id, user_id, status, topic) VALUES ($1,$2,'open',$3)`
	_, err := s.db.Exec(ctx, q, sess.ID, sess.UserID, sess.Topic)
	return sess, err
}

// SendMessage appends the user message, fetches history, calls the AI provider,
// and stores the AI reply. Returns both the user and AI messages.
func (s *Service) SendMessage(ctx context.Context, sessionID, userID string, req SendMessageRequest) (*Message, *Message, error) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM support_sessions WHERE id=$1 AND user_id=$2`, sessionID, userID).Scan(&status); err != nil {
		return nil, nil, errors.New("aicare: session not found")
	}
	if status == string(SessionResolved) {
		return nil, nil, errors.New("aicare: session is resolved — please open a new session")
	}

	userMsg := &Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      RoleUser,
		Content:   req.Content,
		CreatedAt: time.Now(),
	}
	const insertMsg = `INSERT INTO support_messages (id, session_id, role, content) VALUES ($1,$2,$3,$4)`
	if _, err := s.db.Exec(ctx, insertMsg, userMsg.ID, userMsg.SessionID, string(userMsg.Role), userMsg.Content); err != nil {
		return nil, nil, fmt.Errorf("aicare: insert user message: %w", err)
	}

	// Escalated sessions are answered by a human agent — no AI reply.
	var aiMsg *Message
	if status == string(SessionOpen) && s.ai != nil {
		history, _ := s.getHistory(ctx, sessionID, 10)
		aiReply, err := s.ai.Reply(ctx, history, req.Content)
		if err != nil {
			aiReply = "I'm having trouble processing your request right now. Our team will follow up shortly."
		}
		aiMsg = &Message{
			ID:        uuid.New().String(),
			SessionID: sessionID,
			Role:      RoleAI,
			Content:   aiReply,
			CreatedAt: time.Now(),
		}
		s.db.Exec(ctx, insertMsg, aiMsg.ID, aiMsg.SessionID, string(aiMsg.Role), aiMsg.Content)
	}

	return userMsg, aiMsg, nil
}

// Escalate marks a session for human follow-up.
func (s *Service) Escalate(ctx context.Context, sessionID, userID string, req EscalateRequest) error {
	const q = `UPDATE support_sessions SET status='escalated', updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='open'`
	tag, err := s.db.Exec(ctx, q, sessionID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("aicare: session not found or already escalated/resolved")
	}
	if req.Reason != "" {
		s.db.Exec(ctx, `INSERT INTO support_messages (id, session_id, role, content) VALUES ($1,$2,'user',$3)`,
			uuid.New().String(), sessionID, "Escalation reason: "+req.Reason)
	}
	return nil
}

// Resolve closes a session owned by actorID.
func (s *Service) Resolve(ctx context.Context, sessionID, actorID string) error {
	const q = `UPDATE support_sessions SET status='resolved', updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status != 'resolved'`
	tag, err := s.db.Exec(ctx, q, sessionID, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("aicare: session not found or already resolved")
	}
	return nil
}

// GetHistory returns messages for a session.
func (s *Service) GetHistory(ctx context.Context, sessionID, userID string) ([]Message, error) {
	var count int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM support_sessions WHERE id=$1 AND user_id=$2`, sessionID, userID).Scan(&count); err != nil || count == 0 {
		return nil, errors.New("aicare: session not found")
	}
	return s.getHistory(ctx, sessionID, 100)
}

func (s *Service) getHistory(ctx context.Context, sessionID string, limit int) ([]Message, error) {
	const q = `SELECT id, session_id, role, content, created_at FROM support_messages WHERE session_id=$1 ORDER BY created_at ASC LIMIT $2`
	rows, err := s.db.Query(ctx, q, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SessionStatus tracks an AI support session.
type SessionStatus string

const (
	SessionOpen      SessionStatus = "open"
	SessionEscalated SessionStatus = "escalated"
	SessionResolved  SessionStatus = "resolved"
)

// MessageRole identifies who sent a message.
type MessageRole string

const (
	RoleUser  MessageRole = "user"
	RoleAI    MessageRole = "ai"
	RoleAgent MessageRole = "agent"
)

// Session is a customer support conversation.
type Session struct {
	ID        string        `json:"id"`
	UserID    string        `json:"user_id"`
	Status    SessionStatus `json:"status"`
	Topic     string        `json:"topic,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// Message is a single turn in a session.
type Message struct {
	ID        string      `json:"id"`
	SessionID string      `json:"session_id"`
	Role      MessageRole `json:"role"`
	Content   string      `json:"content"`
	CreatedAt time.Time   `json:"created_at"`
}

// CreateSessionRequest opens a new support session.
type CreateSessionRequest struct {
	Topic string `json:"topic"`
}

// SendMessageRequest posts a user message and returns the AI reply.
type SendMessageRequest struct {
	Content string `json:"content" binding:"required,min=1,max=4000"`
}

// EscalateRequest hands off to a human agent.
type EscalateRequest struct {
	Reason string `json:"reason"`
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) CreateSession(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CreateSessionRequest
	c.ShouldBindJSON(&req)
	sess, err := h.svc.CreateSession(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, sess)
}

func (h *Handler) SendMessage(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	userMsg, aiMsg, err := h.svc.SendMessage(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user_message": userMsg, "ai_reply": aiMsg})
}

func (h *Handler) GetHistory(c *gin.Context) {
	userID := ginutil.UserID(c)
	msgs, err := h.svc.GetHistory(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": msgs})
}

func (h *Handler) Escalate(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req EscalateRequest
	c.ShouldBindJSON(&req)
	if err := h.svc.Escalate(c.Request.Context(), c.Param("id"), userID, req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Resolve(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.Resolve(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

const (
	anthropicAPI   = "https://api.anthropic.com/v1/messages"
	anthropicModel = "claude-haiku-4-5-20251001"
	anthropicVer   = "2023-06-01"
	maxTokens      = 1024
)

// AnthropicProvider implements AIProvider using the Anthropic Messages API.
type AnthropicProvider struct {
	apiKey string
	client *http.Client
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{apiKey: apiKey, client: &http.Client{Timeout: 30 * time.Second}}
}

type anthropicMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type anthropicRequest struct {
	Model     string         `json:"model"`
	MaxTokens int            `json:"max_tokens"`
	System    string         `json:"system,omitempty"`
	Messages  []anthropicMsg `json:"messages"`
}
type anthropicContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}
type anthropicResponse struct {
	Content []anthropicContent `json:"content"`
	Error   *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (p *AnthropicProvider) Reply(ctx context.Context, history []Message, userMessage string) (string, error) {
	msgs := make([]anthropicMsg, 0, len(history)+1)
	for _, m := range history {
		role := "user"
		if m.Role == RoleAI || m.Role == RoleAgent {
			role = "assistant"
		}
		msgs = append(msgs, anthropicMsg{Role: role, Content: m.Content})
	}
	msgs = append(msgs, anthropicMsg{Role: "user", Content: userMessage})

	body, _ := json.Marshal(anthropicRequest{
		Model:     anthropicModel,
		MaxTokens: maxTokens,
		System:    "You are a helpful customer support agent for Spotlight, a fintech super-app. Be concise, friendly, and accurate.",
		Messages:  msgs,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicAPI, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("aicare: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", p.apiKey)
	req.Header.Set("Anthropic-Version", anthropicVer)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("aicare: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	var ar anthropicResponse
	if err := json.Unmarshal(raw, &ar); err != nil {
		return "", fmt.Errorf("aicare: decode response: %w", err)
	}
	if ar.Error != nil {
		return "", fmt.Errorf("aicare: anthropic error %s: %s", ar.Error.Type, ar.Error.Message)
	}
	if len(ar.Content) == 0 {
		return "", errors.New("aicare: empty response")
	}
	return ar.Content[0].Text, nil
}
