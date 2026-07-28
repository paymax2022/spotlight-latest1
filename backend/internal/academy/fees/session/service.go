package feessession

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns AcademicSession + Class CRUD for a school. Session status changes go
// through the GUARDED SessionTransition machine (never a raw status write). No money
// moves here; every mutation is audit-logged (module 'academy.fees'). The Store is an
// interface so the guard logic is unit-testable with an in-memory fake.
type Service struct {
	store Store
}

// NewService builds the service over the pgx-backed Repository.
func NewService(db *pgxpool.Pool) *Service { return &Service{store: NewRepository(db)} }

// NewServiceWithStore injects a custom Store (tests).
func NewServiceWithStore(store Store) *Service { return &Service{store: store} }

const dateLayout = "2006-01-02"

func parseDate(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return nil, ErrInvalidDate
	}
	return &t, nil
}

// ── AcademicSession ─────────────────────────────────────────────────────────────

// CreateSession opens an academic session for a school. The session starts 'active'.
func (s *Service) CreateSession(ctx context.Context, actorID, schoolID string, req CreateSessionRequest) (*AcademicSession, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, ErrMissingName
	}
	start, err := parseDate(req.StartDate)
	if err != nil {
		return nil, err
	}
	end, err := parseDate(req.EndDate)
	if err != nil {
		return nil, err
	}
	sess, err := s.store.InsertSession(ctx, AcademicSession{
		SchoolID:      schoolID,
		Name:          req.Name,
		TermStructure: req.TermStructure,
		StartDate:     start,
		EndDate:       end,
	})
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "session_created", "academy_session", sess.ID, "", string(SessionActive),
		map[string]any{"schoolId": schoolID, "name": req.Name})
	return sess, nil
}

func (s *Service) GetSession(ctx context.Context, id string) (*AcademicSession, error) {
	return s.store.GetSession(ctx, id)
}

func (s *Service) ListSessions(ctx context.Context, schoolID string) ([]AcademicSession, error) {
	return s.store.ListSessions(ctx, schoolID)
}

// SetSessionStatus advances a session through the guarded status machine
// (active→closed→archived). Illegal moves are rejected (audited) — never a raw write.
func (s *Service) SetSessionStatus(ctx context.Context, actorID, id string, status SessionStatus) (*AcademicSession, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	cur, err := s.store.GetSession(ctx, id)
	if err != nil {
		return nil, err
	}
	to, err := SessionTransition(cur.Status, status)
	if err != nil {
		_ = s.store.WriteAudit(ctx, actorID, "session_status_rejected", "academy_session", id,
			string(cur.Status), string(status), map[string]any{"reason": err.Error()})
		return nil, err
	}
	out, err := s.store.SetSessionStatus(ctx, id, cur.Status, to)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "session_status_changed", "academy_session", id,
		string(cur.Status), string(to), map[string]any{})
	return out, nil
}

// ── Class ───────────────────────────────────────────────────────────────────────

// CreateClass opens a class within a school (optionally bound to a session). When a
// session is supplied it is validated to belong to the SAME school (fail-closed).
func (s *Service) CreateClass(ctx context.Context, actorID, schoolID string, req CreateClassRequest) (*Class, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, ErrMissingName
	}
	if req.SessionID != "" {
		sess, err := s.store.GetSession(ctx, req.SessionID)
		if err != nil {
			return nil, err
		}
		if sess.SchoolID != schoolID {
			return nil, ErrSchoolMismatch
		}
	}
	cls, err := s.store.InsertClass(ctx, Class{
		SchoolID:           schoolID,
		SessionID:          ptrOrNil(req.SessionID),
		Name:               req.Name,
		Level:              ptrOrNil(req.Level),
		ClassTeacherUserID: ptrOrNil(req.ClassTeacherUserID),
	})
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "class_created", "academy_fee_class", cls.ID, "", "",
		map[string]any{"schoolId": schoolID, "sessionId": req.SessionID, "name": req.Name})
	return cls, nil
}

func (s *Service) GetClass(ctx context.Context, id string) (*Class, error) {
	return s.store.GetClass(ctx, id)
}

func (s *Service) ListClasses(ctx context.Context, schoolID, sessionID string) ([]Class, error) {
	return s.store.ListClasses(ctx, schoolID, sessionID)
}

// UpdateClass edits a class's descriptive fields / class teacher.
func (s *Service) UpdateClass(ctx context.Context, actorID, id string, req UpdateClassRequest) (*Class, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	out, err := s.store.UpdateClass(ctx, id, req)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "class_updated", "academy_fee_class", id, "", "", map[string]any{})
	return out, nil
}
