package investai

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
