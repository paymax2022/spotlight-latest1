package connecttrust

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	connectsafety "spotlight/backend/internal/connect/safety"
)

// ShieldStore persists scam-shield flags (reason codes surfaced to moderators)
// and, once the config-driven flag count is reached, opens a connect_case via
// the existing safety service so flagged conversations always reach moderation.
type ShieldStore struct {
	db     *pgxpool.Pool
	cfg    *ConfigReader
	safety *connectsafety.Service
}

// NewShieldStore wires the shield over the pool, the config reader, and the
// Phase-0 safety service (case + audit backbone).
func NewShieldStore(db *pgxpool.Pool, cfg *ConfigReader, safety *connectsafety.Service) *ShieldStore {
	return &ShieldStore{db: db, cfg: cfg, safety: safety}
}

// FlagInput records one scam-shield hit. message_id may be empty (e.g. a
// profile-level flag). subjectID is the user the flag is about.
type FlagInput struct {
	ConversationID string
	MessageID      string
	SubjectID      string
	Category       Category
	ReasonCodes    []string
	Score          int
}

// FlagResult tells the caller what the shield did so the chat layer can mirror
// the safety_state transition and surface the warning.
type FlagResult struct {
	FlagID       string
	CaseOpened   bool
	CaseID       string
	Escalate     bool // conversation should move to under_review
	TotalFlags   int
}

// Flag stores a scam-shield flag, then evaluates config thresholds:
//   - at >= flag_to_case_threshold flags in the conversation, open a connect_case
//     (deduped: only open while no open case already references this conversation).
//   - at >= escalate_score cumulative score, signal the conversation to escalate.
//
// The flag write itself NEVER fails silently: a DB error bubbles to the caller.
func (s *ShieldStore) Flag(ctx context.Context, in FlagInput) (FlagResult, error) {
	thresholds, err := s.cfg.Load(ctx)
	if err != nil {
		// Fail-closed: if we cannot read thresholds we still store the flag but
		// refuse to suppress escalation — treat as escalate to be safe.
		thresholds = Thresholds{FlagToCase: 1, EscalateScore: 1}
	}

	const ins = `INSERT INTO connect_scam_shield_flags
		(conversation_id, message_id, subject_id, category, reason_codes, score)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6)
		RETURNING id`
	var res FlagResult
	if err := s.db.QueryRow(ctx, ins,
		in.ConversationID, in.MessageID, in.SubjectID,
		string(in.Category), in.ReasonCodes, in.Score,
	).Scan(&res.FlagID); err != nil {
		return FlagResult{}, fmt.Errorf("connect: store scam-shield flag: %w", err)
	}

	// Tally this conversation's flags + cumulative score.
	totalFlags, totalScore, err := s.conversationTally(ctx, in.ConversationID)
	if err != nil {
		return FlagResult{}, err
	}
	res.TotalFlags = totalFlags
	res.Escalate = thresholds.EscalateScore > 0 && totalScore >= thresholds.EscalateScore

	if thresholds.FlagToCase > 0 && totalFlags >= thresholds.FlagToCase {
		opened, caseID, err := s.openCaseIfNone(ctx, in)
		if err != nil {
			return FlagResult{}, err
		}
		res.CaseOpened = opened
		res.CaseID = caseID
	}
	return res, nil
}

func (s *ShieldStore) conversationTally(ctx context.Context, convID string) (int, int, error) {
	if convID == "" {
		return 0, 0, nil
	}
	const q = `SELECT COUNT(*), COALESCE(SUM(score),0)
		FROM connect_scam_shield_flags WHERE conversation_id = $1::uuid`
	var n, score int
	if err := s.db.QueryRow(ctx, q, convID).Scan(&n, &score); err != nil {
		return 0, 0, fmt.Errorf("connect: tally scam flags: %w", err)
	}
	return n, score, nil
}

// openCaseIfNone opens a scam case for the subject only if no open case already
// references this conversation (idempotent — repeated flags don't spam cases).
func (s *ShieldStore) openCaseIfNone(ctx context.Context, in FlagInput) (bool, string, error) {
	if in.ConversationID != "" {
		const exists = `SELECT id FROM connect_cases
			WHERE source_ref = $1 AND type = 'scam' AND status IN ('open','investigating') LIMIT 1`
		var existingID string
		if err := s.db.QueryRow(ctx, exists, in.ConversationID).Scan(&existingID); err == nil {
			return false, existingID, nil // already has an open case
		}
	}
	c, err := s.safety.OpenCase(ctx, connectsafety.OpenCaseInput{
		ReporterID: "", // system-opened
		SubjectID:  in.SubjectID,
		Type:       caseTypeFor(in.Category),
		SourceRef:  in.ConversationID,
		Severity:   "high",
		Notes:      "Auto-opened by scam-shield after repeated safety flags. Reason codes: " + joinCodes(in.ReasonCodes),
	})
	if err != nil {
		return false, "", fmt.Errorf("connect: scam-shield open case: %w", err)
	}
	return true, c.ID, nil
}

// caseTypeFor maps a detection category to a valid connect_cases.type.
func caseTypeFor(cat Category) string {
	switch cat {
	case CategoryFinancial:
		return "scam"
	case CategoryOffPlatform:
		return "off_platform"
	case CategoryHarassment:
		return "harassment"
	case CategoryImpersonation:
		return "impersonation"
	default:
		return "safety"
	}
}

func joinCodes(codes []string) string {
	out := ""
	for i, c := range codes {
		if i > 0 {
			out += ", "
		}
		out += c
	}
	if out == "" {
		return "(none)"
	}
	return out
}

// ListFlags returns recent scam-shield flags for the moderator surface.
func (s *ShieldStore) ListFlags(ctx context.Context, limit int) ([]ShieldFlag, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, conversation_id, message_id, subject_id, category, reason_codes, score, case_id, created_at
		FROM connect_scam_shield_flags ORDER BY created_at DESC LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list scam flags: %w", err)
	}
	defer rows.Close()
	var out []ShieldFlag
	for rows.Next() {
		var f ShieldFlag
		if err := rows.Scan(&f.ID, &f.ConversationID, &f.MessageID, &f.SubjectID,
			&f.Category, &f.ReasonCodes, &f.Score, &f.CaseID, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
