package feessession

import (
	"context"
	"errors"
	"testing"
)

// PURE tests — no DB. The pgx Repository is replaced by an in-memory fakeStore so the
// session status machine, the class↔session same-school guard, and CRUD flow are all
// exercised without a live DB (mirrors edupay_test.go isolation).

type fakeStore struct {
	sessions map[string]*AcademicSession
	classes  map[string]*Class
	seq      int
}

func newFakeStore() *fakeStore {
	return &fakeStore{sessions: map[string]*AcademicSession{}, classes: map[string]*Class{}}
}

func (f *fakeStore) InsertSession(_ context.Context, s AcademicSession) (*AcademicSession, error) {
	f.seq++
	s.ID = "sess-" + itoa(f.seq)
	s.Status = SessionActive
	cp := s
	f.sessions[s.ID] = &cp
	out := cp
	return &out, nil
}

func (f *fakeStore) GetSession(_ context.Context, id string) (*AcademicSession, error) {
	s, ok := f.sessions[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *s
	return &out, nil
}

func (f *fakeStore) ListSessions(_ context.Context, schoolID string) ([]AcademicSession, error) {
	out := []AcademicSession{}
	for _, s := range f.sessions {
		if s.SchoolID == schoolID {
			out = append(out, *s)
		}
	}
	return out, nil
}

func (f *fakeStore) SetSessionStatus(_ context.Context, id string, from, to SessionStatus) (*AcademicSession, error) {
	s, ok := f.sessions[id]
	if !ok {
		return nil, ErrNotFound
	}
	if s.Status != from {
		return nil, ErrIllegalTransition
	}
	s.Status = to
	out := *s
	return &out, nil
}

func (f *fakeStore) InsertClass(_ context.Context, c Class) (*Class, error) {
	f.seq++
	c.ID = "class-" + itoa(f.seq)
	cp := c
	f.classes[c.ID] = &cp
	out := cp
	return &out, nil
}

func (f *fakeStore) GetClass(_ context.Context, id string) (*Class, error) {
	c, ok := f.classes[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *c
	return &out, nil
}

func (f *fakeStore) ListClasses(_ context.Context, schoolID, sessionID string) ([]Class, error) {
	out := []Class{}
	for _, c := range f.classes {
		if c.SchoolID == schoolID && (sessionID == "" || deref(c.SessionID) == sessionID) {
			out = append(out, *c)
		}
	}
	return out, nil
}

func (f *fakeStore) UpdateClass(_ context.Context, id string, req UpdateClassRequest) (*Class, error) {
	c, ok := f.classes[id]
	if !ok {
		return nil, ErrNotFound
	}
	if req.Name != "" {
		c.Name = req.Name
	}
	out := *c
	return &out, nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, _, _, _, _, _ string, _ any) error { return nil }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// ── Session status machine (pure) ────────────────────────────────────────────────

func TestSessionTransition_LegalAndIllegal(t *testing.T) {
	legal := [][2]SessionStatus{
		{SessionActive, SessionClosed},
		{SessionClosed, SessionArchived},
		{SessionActive, SessionArchived},
	}
	for _, tr := range legal {
		if _, err := SessionTransition(tr[0], tr[1]); err != nil {
			t.Errorf("expected %s→%s legal, got %v", tr[0], tr[1], err)
		}
	}
	illegal := [][2]SessionStatus{
		{SessionArchived, SessionActive}, // terminal
		{SessionArchived, SessionClosed}, // terminal
		{SessionClosed, SessionActive},   // no reopen
		{SessionActive, SessionActive},   // no-op
	}
	for _, tr := range illegal {
		if _, err := SessionTransition(tr[0], tr[1]); !errors.Is(err, ErrIllegalTransition) {
			t.Errorf("expected %s→%s ErrIllegalTransition, got %v", tr[0], tr[1], err)
		}
	}
	if _, err := SessionTransition(SessionActive, SessionStatus("frozen")); !errors.Is(err, ErrInvalidStatus) {
		t.Errorf("expected ErrInvalidStatus for unknown status, got %v", err)
	}
}

func TestServiceSetSessionStatus_GuardedAndAudited(t *testing.T) {
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	ctx := context.Background()
	sess, err := svc.CreateSession(ctx, "owner-1", "school-1", CreateSessionRequest{Name: "2026/2027"})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	// Legal: active → closed.
	out, err := svc.SetSessionStatus(ctx, "owner-1", sess.ID, SessionClosed)
	if err != nil {
		t.Fatalf("active→closed: %v", err)
	}
	if out.Status != SessionClosed {
		t.Fatalf("expected closed, got %s", out.Status)
	}
	// Illegal: closed → active (no reopen) — MUST be refused, status unchanged.
	if _, err := svc.SetSessionStatus(ctx, "owner-1", sess.ID, SessionActive); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("expected illegal_transition on reopen, got %v", err)
	}
	cur, _ := svc.GetSession(ctx, sess.ID)
	if cur.Status != SessionClosed {
		t.Fatalf("status must remain closed after rejected reopen, got %s", cur.Status)
	}
}

// ── Class: same-school session guard ─────────────────────────────────────────────

func TestServiceCreateClass_SessionMustMatchSchool(t *testing.T) {
	fs := newFakeStore()
	svc := NewServiceWithStore(fs)
	ctx := context.Background()
	sess, _ := svc.CreateSession(ctx, "owner-1", "school-1", CreateSessionRequest{Name: "2026/2027"})

	// Class in a DIFFERENT school referencing school-1's session ⇒ ErrSchoolMismatch.
	if _, err := svc.CreateClass(ctx, "owner-1", "school-2", CreateClassRequest{Name: "JSS1", SessionID: sess.ID}); !errors.Is(err, ErrSchoolMismatch) {
		t.Fatalf("expected school_mismatch, got %v", err)
	}
	// Same school ⇒ ok, teacher recorded.
	cls, err := svc.CreateClass(ctx, "owner-1", "school-1", CreateClassRequest{Name: "JSS1", SessionID: sess.ID, ClassTeacherUserID: "teacher-9"})
	if err != nil {
		t.Fatalf("create class: %v", err)
	}
	if deref(cls.ClassTeacherUserID) != "teacher-9" {
		t.Fatalf("class teacher must be recorded, got %q", deref(cls.ClassTeacherUserID))
	}
	if deref(cls.SessionID) != sess.ID {
		t.Fatalf("class must be bound to the session, got %q", deref(cls.SessionID))
	}
}

func TestServiceCreateSession_ValidatesInput(t *testing.T) {
	svc := NewServiceWithStore(newFakeStore())
	ctx := context.Background()
	if _, err := svc.CreateSession(ctx, "owner-1", "school-1", CreateSessionRequest{Name: "  "}); !errors.Is(err, ErrMissingName) {
		t.Fatalf("expected missing_name, got %v", err)
	}
	if _, err := svc.CreateSession(ctx, "owner-1", "school-1", CreateSessionRequest{Name: "x", StartDate: "not-a-date"}); !errors.Is(err, ErrInvalidDate) {
		t.Fatalf("expected invalid_date, got %v", err)
	}
	if _, err := svc.CreateSession(ctx, "", "school-1", CreateSessionRequest{Name: "x"}); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unauthenticated, got %v", err)
	}
}
