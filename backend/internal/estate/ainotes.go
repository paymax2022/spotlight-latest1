package estate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ainotes.go — Block 33 AI note-taking: turn a meeting transcript into a
// structured summary, action items and decisions via the Anthropic Messages API
// (claude-sonnet-4-6), persisted to estate_ai_notes with an approval workflow.

// LLMGenerator is the narrow slice of the LLM client the estate package needs.
// Satisfied by *llm.Client. Kept as an interface so the package stays decoupled
// and the JSON-parsing path is unit-testable with a stub.
type LLMGenerator interface {
	Enabled() bool
	Model() string
	GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)
}

// WithLLM wires the LLM client used for AI note-taking. When unset (or the client
// is not configured), the AI-notes endpoints fail closed rather than fabricating
// output.
func (s *Service) WithLLM(g LLMGenerator) *Service {
	s.llm = g
	return s
}

// AINoteSession is one AI-processed set of meeting notes.
type AINoteSession struct {
	ID          string          `json:"id"`
	EstateID    string          `json:"estate_id"`
	MeetingID   *string         `json:"meeting_id,omitempty"`
	Title       string          `json:"title"`
	Transcript  string          `json:"transcript,omitempty"`
	Summary     string          `json:"summary"`
	ActionItems json.RawMessage `json:"action_items"`
	Decisions   json.RawMessage `json:"decisions"`
	Status      string          `json:"status"` // processing | complete | failed
	Model       string          `json:"model,omitempty"`
	CreatedBy   string          `json:"created_by"`
	ApprovedBy  *string         `json:"approved_by,omitempty"`
	ApprovedAt  *time.Time      `json:"approved_at,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

// GenerateAINotesRequest is the body for AI note generation.
type GenerateAINotesRequest struct {
	MeetingID  string `json:"meeting_id" binding:"required"`
	Title      string `json:"title"`
	Transcript string `json:"transcript" binding:"required,min=20"`
}

// aiNotesSystemPrompt instructs the model to return ONLY strict JSON.
const aiNotesSystemPrompt = `You are an estate-association meeting secretary. Read the meeting transcript and produce concise, faithful minutes. Respond with ONLY valid JSON, no markdown, in exactly this shape:
{
  "summary": "string, <= 300 words, neutral tone",
  "action_items": [ { "task": "string", "assignee": "string or empty", "due_date": "YYYY-MM-DD or empty" } ],
  "decisions": [ "string" ],
  "unresolved": [ "string" ]
}
Do not invent facts that are not supported by the transcript. If a field has no content, use an empty string or empty array.`

// aiNoteParsed is the strict shape we expect back from the model.
type aiNoteParsed struct {
	Summary     string            `json:"summary"`
	ActionItems []json.RawMessage `json:"action_items"`
	Decisions   []json.RawMessage `json:"decisions"`
	Unresolved  []json.RawMessage `json:"unresolved"`
}

// parseAINoteResult validates the model output and returns the summary plus the
// action_items and decisions as canonical JSON arrays. Pure (no DB / no network)
// so the contract is unit-testable. Decisions includes any "unresolved" items so
// nothing is silently dropped.
func parseAINoteResult(raw json.RawMessage) (summary string, actionItems, decisions json.RawMessage, err error) {
	var p aiNoteParsed
	if e := json.Unmarshal(raw, &p); e != nil {
		return "", nil, nil, fmt.Errorf("estate: AI output not in expected shape: %w", e)
	}
	if p.Summary == "" {
		return "", nil, nil, fmt.Errorf("estate: AI output missing summary")
	}
	ai := p.ActionItems
	if ai == nil {
		ai = []json.RawMessage{}
	}
	aiJSON, _ := json.Marshal(ai)
	// Merge decisions + unresolved (unresolved are decisions still pending).
	dec := append([]json.RawMessage{}, p.Decisions...)
	dec = append(dec, p.Unresolved...)
	if dec == nil {
		dec = []json.RawMessage{}
	}
	decJSON, _ := json.Marshal(dec)
	return p.Summary, aiJSON, decJSON, nil
}

const aiNoteCols = `id, estate_id, meeting_id, COALESCE(title,''), COALESCE(transcript,''), COALESCE(summary,''),
	action_items, decisions, status, COALESCE(model,''), created_by, approved_by, approved_at, created_at`

func scanAINote(row interface{ Scan(...any) error }) (*AINoteSession, error) {
	var n AINoteSession
	if err := row.Scan(&n.ID, &n.EstateID, &n.MeetingID, &n.Title, &n.Transcript, &n.Summary,
		&n.ActionItems, &n.Decisions, &n.Status, &n.Model, &n.CreatedBy, &n.ApprovedBy, &n.ApprovedAt, &n.CreatedAt); err != nil {
		return nil, err
	}
	return &n, nil
}

// GenerateAINotes processes a transcript into structured notes (estate admin
// only). A session row is created in 'processing' state first, then updated to
// 'complete' with the model output, or 'failed' if the LLM is unavailable/errors.
func (s *Service) GenerateAINotes(ctx context.Context, estateID, adminID string, req GenerateAINotesRequest) (*AINoteSession, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if err := s.assertMeetingInEstate(ctx, estateID, req.MeetingID); err != nil {
		return nil, err
	}

	id := uuid.New().String()
	title := req.Title
	if title == "" {
		title = "Meeting notes"
	}
	// summary is NOT NULL on estate_ai_notes — seed it empty until the model fills it.
	const ins = `INSERT INTO estate_ai_notes (id, estate_id, meeting_id, title, transcript, summary, status, created_by, source)
		VALUES ($1,$2,$3,$4,$5,'','processing',$6,'generated')`
	if _, err := s.db.Exec(ctx, ins, id, estateID, req.MeetingID, title, req.Transcript, adminID); err != nil {
		return nil, fmt.Errorf("estate: create ai-note session: %w", err)
	}

	if s.llm == nil || !s.llm.Enabled() {
		_, _ = s.db.Exec(ctx, `UPDATE estate_ai_notes SET status='failed' WHERE id=$1`, id)
		return nil, fmt.Errorf("estate: AI note-taking is not configured")
	}

	userPrompt := fmt.Sprintf("Meeting title: %s\n\nTranscript:\n%s", title, req.Transcript)
	raw, err := s.llm.GenerateJSON(ctx, aiNotesSystemPrompt, userPrompt)
	if err != nil {
		_, _ = s.db.Exec(ctx, `UPDATE estate_ai_notes SET status='failed' WHERE id=$1`, id)
		return nil, fmt.Errorf("estate: AI generation failed: %w", err)
	}
	summary, actionItems, decisions, err := parseAINoteResult(raw)
	if err != nil {
		_, _ = s.db.Exec(ctx, `UPDATE estate_ai_notes SET status='failed' WHERE id=$1`, id)
		return nil, err
	}

	const upd = `UPDATE estate_ai_notes SET summary=$2, action_items=$3, decisions=$4, status='complete', model=$5 WHERE id=$1`
	if _, err := s.db.Exec(ctx, upd, id, summary, actionItems, decisions, s.llm.Model()); err != nil {
		return nil, fmt.Errorf("estate: save ai-note: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "AI_NOTES_GENERATE", "meeting", req.MeetingID, map[string]any{"session_id": id, "model": s.llm.Model()})
	return s.GetAINote(ctx, estateID, adminID, id)
}

// GetAINote returns one AI-note session (members).
func (s *Service) GetAINote(ctx context.Context, estateID, userID, id string) (*AINoteSession, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `SELECT `+aiNoteCols+` FROM estate_ai_notes WHERE id=$1 AND estate_id=$2`, id, estateID)
	n, err := scanAINote(row)
	if err != nil {
		return nil, fmt.Errorf("estate: ai-note not found in this estate")
	}
	return n, nil
}

// ListAINotes lists AI-note sessions, optionally filtered by meeting (members).
func (s *Service) ListAINotes(ctx context.Context, estateID, userID, meetingID string) ([]AINoteSession, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	q := `SELECT ` + aiNoteCols + ` FROM estate_ai_notes WHERE estate_id=$1`
	args := []any{estateID}
	if meetingID != "" {
		q += " AND meeting_id=$2"
		args = append(args, meetingID)
	}
	q += " ORDER BY created_at DESC LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AINoteSession
	for rows.Next() {
		n, err := scanAINote(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, rows.Err()
}

// ApproveAINote marks an AI-note session approved (estate admin only).
func (s *Service) ApproveAINote(ctx context.Context, estateID, adminID, id string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE estate_ai_notes SET approved_by=$1, approved_at=NOW() WHERE id=$2 AND estate_id=$3 AND status='complete'`,
		adminID, id, estateID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: ai-note not found or not in a completable state")
	}
	_ = s.audit(ctx, estateID, adminID, "AI_NOTES_APPROVE", "ai_note", id, nil)
	return nil
}
