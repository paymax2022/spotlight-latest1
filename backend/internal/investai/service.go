package investai

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyUnauthenticated = "unauthenticated"

const keyError = "error"

var (
	ErrNotFound  = errors.New("investai: session not found")
	ErrForbidden = errors.New("investai: not your session")
	ErrBadInput  = errors.New("investai: invalid input")
)

// advicefPatterns signal a request for personalized advice, a price prediction,
// or a guarantee. Such prompts are refused server-side and redirected to
// education, mirroring the mobile mock policy (ai.mock.ts ADVICE_PATTERNS).
var advicePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)should i (buy|sell|invest|hold|put)`),
	regexp.MustCompile(`(?i)\bwhat should i (buy|invest|do)\b`),
	regexp.MustCompile(`(?i)\b(which|what)('?s| is)? (the )?(best|top) (stock|coin|crypto|asset|investment)`),
	regexp.MustCompile(`(?i)best (stock|coin|crypto|asset) to (buy|invest)`),
	regexp.MustCompile(`(?i)\b(will|is|are|gonna|going to) .*(go up|go down|moon|pump|dump|crash|rise|drop|rally)`),
	regexp.MustCompile(`(?i)\b(price|when) .*(prediction|predict|forecast|target|hit|reach)\b`),
	regexp.MustCompile(`(?i)\bhow (high|low|much) will .* (go|be|reach)\b`),
	regexp.MustCompile(`(?i)\bguarantee(d)?\b`),
	regexp.MustCompile(`(?i)\b(risk[- ]?free|sure thing|can'?t lose|no risk)\b`),
	regexp.MustCompile(`(?i)\b(double|triple|10x|100x|get rich)\b`),
	regexp.MustCompile(`(?i)\btell me what to (buy|invest|do)\b`),
	regexp.MustCompile(`(?i)\b(is|are) .* a good (buy|investment|time to buy)\b`),
}

// isAdviceSeeking reports whether the prompt seeks advice / a prediction / a
// guarantee and should be refused.
func isAdviceSeeking(prompt string) bool {
	for _, re := range advicePatterns {
		if re.MatchString(prompt) {
			return true
		}
	}
	return false
}

// Service manages InvestAI education sessions and message routing. It persists to
// Postgres via pgx and generates assistant replies through the pluggable
// AIProvider (real Anthropic or deterministic mock). No money path is involved.
type Service struct {
	db *pgxpool.Pool
	ai AIProvider
}

func NewService(db *pgxpool.Pool, ai AIProvider) *Service {
	return &Service{db: db, ai: ai}
}

// CreateSession opens a fresh education session for a user.
func (s *Service) CreateSession(ctx context.Context, userID, title string) (*ChatSession, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	sess := &ChatSession{
		ID:        uuid.New().String(),
		UserID:    userID,
		Title:     title,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	const q = `INSERT INTO investai_sessions (id, user_id, title) VALUES ($1,$2,$3)`
	if _, err := s.db.Exec(ctx, q, sess.ID, sess.UserID, sess.Title); err != nil {
		return nil, err
	}
	return sess, nil
}

// ListSessions returns the caller's sessions, newest-first.
func (s *Service) ListSessions(ctx context.Context, userID string) ([]ChatSession, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	const q = `SELECT id, user_id, title, created_at, updated_at
	           FROM investai_sessions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatSession{}
	for rows.Next() {
		var c ChatSession
		if err := rows.Scan(&c.ID, &c.UserID, &c.Title, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ownSession verifies the session exists and belongs to the caller.
func (s *Service) ownSession(ctx context.Context, sessionID, userID string) error {
	var owner string
	err := s.db.QueryRow(ctx, `SELECT user_id FROM investai_sessions WHERE id=$1`, sessionID).Scan(&owner)
	if err != nil {
		return ErrNotFound
	}
	if owner != userID {
		return ErrForbidden
	}
	return nil
}

// GetHistory returns the messages in an owner-scoped session, oldest-first.
func (s *Service) GetHistory(ctx context.Context, sessionID, userID string) ([]ChatMessage, error) {
	if err := s.ownSession(ctx, sessionID, userID); err != nil {
		return nil, err
	}
	return s.getHistory(ctx, sessionID, 100)
}

func (s *Service) getHistory(ctx context.Context, sessionID string, limit int) ([]ChatMessage, error) {
	const q = `SELECT id, session_id, role, text, disclaimer, refused, created_at
	           FROM investai_messages WHERE session_id=$1 ORDER BY created_at ASC LIMIT $2`
	rows, err := s.db.Query(ctx, q, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatMessage{}
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Text, &m.Disclaimer, &m.Refused, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Service) appendMessage(ctx context.Context, m *ChatMessage) error {
	const q = `INSERT INTO investai_messages (id, session_id, role, text, disclaimer, refused)
	           VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, q, m.ID, m.SessionID, string(m.Role), m.Text, m.Disclaimer, m.Refused); err != nil {
		return err
	}
	// Touch the session so ListSessions orders by recency.
	s.db.Exec(ctx, `UPDATE investai_sessions SET updated_at=NOW() WHERE id=$1`, m.SessionID)
	return nil
}

// Chat handles one education turn: it resolves (or creates) the session, persists
// the user message, generates an educational assistant reply — refusing
// advice-seeking prompts — persists it, and returns the assistant turn. Every
// assistant turn is disclaimered.
func (s *Service) Chat(ctx context.Context, userID string, req ChatRequest) (*ChatResponse, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, ErrBadInput
	}

	// Resolve session: reuse the caller's session when supplied (owner-checked),
	// otherwise open a fresh one titled from the opening prompt.
	sessionID := req.SessionID
	if sessionID == "" {
		title := prompt
		if len(title) > 60 {
			title = title[:60]
		}
		sess, err := s.CreateSession(ctx, userID, title)
		if err != nil {
			return nil, err
		}
		sessionID = sess.ID
	} else if err := s.ownSession(ctx, sessionID, userID); err != nil {
		return nil, err
	}

	// Persist the user turn.
	userMsg := &ChatMessage{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      RoleUser,
		Text:      prompt,
		CreatedAt: time.Now(),
	}
	if err := s.appendMessage(ctx, userMsg); err != nil {
		return nil, err
	}

	// Guardrail: refuse advice-seeking prompts before any model call.
	var replyText string
	refused := false
	if isAdviceSeeking(prompt) {
		replyText = Refusal
		refused = true
	} else if s.ai != nil {
		history, _ := s.getHistory(ctx, sessionID, 10)
		// Exclude the just-inserted user turn from history (it is passed separately).
		if n := len(history); n > 0 && history[n-1].ID == userMsg.ID {
			history = history[:n-1]
		}
		txt, err := s.ai.Reply(ctx, history, prompt)
		if err != nil || strings.TrimSpace(txt) == "" {
			// Fail closed to a safe educational fallback rather than surfacing an error.
			replyText = mockGeneric
		} else {
			replyText = txt
		}
	} else {
		replyText = mockGeneric
	}

	assistantMsg := &ChatMessage{
		ID:         uuid.New().String(),
		SessionID:  sessionID,
		Role:       RoleAssistant,
		Text:       replyText,
		Disclaimer: true,
		Refused:    refused,
		CreatedAt:  time.Now(),
	}
	if err := s.appendMessage(ctx, assistantMsg); err != nil {
		return nil, err
	}

	return &ChatResponse{
		SessionID:  sessionID,
		Text:       replyText,
		Refused:    refused,
		Disclaimer: Disclaimer,
		Message:    assistantMsg,
	}, nil
}

// ExplainAsset returns a neutral, educational summary for a single asset symbol —
// never a recommendation. This is stateless (not persisted to a session).
func (s *Service) ExplainAsset(ctx context.Context, symbol string) (*ExplainAssetResponse, error) {
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	if sym == "" {
		return nil, ErrBadInput
	}
	text := "Here's a neutral overview of " + sym + ". " + sym + " is an asset that can be bought " +
		"and sold on Paymax where it's enabled and you meet the eligibility checks. Like most " +
		"tradable assets, its price can be volatile and move sharply in either direction, and it " +
		"is not a bank deposit. Before trading, it helps to understand the asset's risk disclosure, " +
		"the fees and spread shown on the quote, and how much you'd be comfortable risking. This is " +
		"general education about " + sym + " — not a recommendation to buy, sell, or hold it."
	return &ExplainAssetResponse{Symbol: sym, Text: text, Disclaimer: Disclaimer}, nil
}

// RegisterInvestAI mounts the InvestAI education routes on the provided group. The
// caller passes a group already scoped to /api/v1/ai/invest and already carrying
// the auth middleware (user_id mirrored onto the gin context), matching the mobile
// base path (mobile-app/reactnative/src/features/investai/api/ai.api.ts).
//
//	POST /chat                    — one education turn { prompt, context?, session_id? }
//	POST /explain-asset           — neutral educational summary of one symbol { symbol }
//	GET  /sessions                — list the caller's education sessions
//	GET  /sessions/:id/messages   — owner-scoped chat history for a session
//
// Every assistant turn is educational and disclaimered; advice-seeking prompts are
// refused server-side. No money path.
func RegisterInvestAI(g *gin.RouterGroup, h *Handler) {
	g.POST("/chat", h.Chat)
	g.POST("/explain-asset", h.ExplainAsset)
	g.GET("/sessions", h.ListSessions)
	g.GET("/sessions/:id/messages", h.GetHistory)
}

// Handler exposes the InvestAI education API. user_id is set on the gin context by
// the auth middleware (c.GetString("user_id")) — the same OLA convention the learn
// and invest modules use. Responses are returned as the raw payload (no envelope)
// to match the mobile api wrapper's unwrap(res.data?.data ?? res.data).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusForbidden, ErrForbidden),
	httperr.R(http.StatusBadRequest, ErrBadInput),
)

// httpErr writes the mapped status; unknown errors get a generic 500 body so
// internals never leak to the client.
func httpErr(c *gin.Context, err error) {
	if code := errMap.Code(err); code != http.StatusInternalServerError {
		c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{keyError: "something went wrong"})
}

// Chat — POST /chat  { prompt, context?, session_id? } → { session_id, text, refused, disclaimer }
func (h *Handler) Chat(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid body"})
		return
	}
	res, err := h.svc.Chat(c.Request.Context(), uid, req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ExplainAsset — POST /explain-asset  { symbol } → { symbol, text, disclaimer }
func (h *Handler) ExplainAsset(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var req ExplainAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid body"})
		return
	}
	res, err := h.svc.ExplainAsset(c.Request.Context(), req.Symbol)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListSessions — GET /sessions → [ ChatSession ]
func (h *Handler) ListSessions(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	sessions, err := h.svc.ListSessions(c.Request.Context(), uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, sessions)
}

// GetHistory — GET /sessions/:id/messages → [ ChatMessage ] (owner-scoped)
func (h *Handler) GetHistory(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	msgs, err := h.svc.GetHistory(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, msgs)
}
