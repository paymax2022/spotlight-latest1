package services

import (
	"testing"
	"time"

	"spotlight/backend/internal/config"
)

// ── In-memory fake store ─────────────────────────────────────────────────────

type fakeSessionStore struct {
	sessions       map[string]*Session // id -> session
	seq            int
	securityEvents []SecurityEvent
	forceFlags     map[string][2]bool // userID -> {reset, reverify}

	knownDevices map[string]bool // userID|fp
	knownIPs     map[string]bool // userID|ip
	failedCount  int
	lastSuccess  *LoginActivity
}

func newFakeStore() *fakeSessionStore {
	return &fakeSessionStore{
		sessions:     map[string]*Session{},
		forceFlags:   map[string][2]bool{},
		knownDevices: map[string]bool{},
		knownIPs:     map[string]bool{},
	}
}

func (f *fakeSessionStore) CreateSession(s Session) (string, error) {
	f.seq++
	id := "sess-" + itoa(f.seq)
	s.ID = id
	if s.FamilyID == "" {
		s.FamilyID = id
	}
	cp := s
	f.sessions[id] = &cp
	return id, nil
}

func (f *fakeSessionStore) GetByRefreshHash(hash string) (*Session, error) {
	for _, s := range f.sessions {
		if s.RefreshTokenHash == hash {
			cp := *s
			return &cp, nil
		}
	}
	return nil, nil
}

func (f *fakeSessionStore) FindByPreviousRefreshHash(hash string) (*Session, error) {
	for _, s := range f.sessions {
		if s.PreviousTokenHash == hash {
			cp := *s
			return &cp, nil
		}
	}
	return nil, nil
}

func (f *fakeSessionStore) GetByAccessHash(hash string) (*Session, error) {
	for _, s := range f.sessions {
		if s.AccessTokenHash == hash {
			cp := *s
			return &cp, nil
		}
	}
	return nil, nil
}

func (f *fakeSessionStore) GetSessionByID(id string) (*Session, error) {
	if s, ok := f.sessions[id]; ok {
		cp := *s
		return &cp, nil
	}
	return nil, nil
}

func (f *fakeSessionStore) ListActiveByUser(userID string) ([]Session, error) {
	now := time.Now().UTC()
	var out []Session
	for _, s := range f.sessions {
		if s.UserID == userID && s.Active(now) {
			out = append(out, *s)
		}
	}
	return out, nil
}

func (f *fakeSessionStore) RotateSession(id, newRefresh, prevRefresh, newAccess string, counter int, expiresAt time.Time) error {
	if s, ok := f.sessions[id]; ok {
		s.RefreshTokenHash = newRefresh
		s.PreviousTokenHash = prevRefresh
		s.AccessTokenHash = newAccess
		s.RotationCounter = counter
		s.ExpiresAt = expiresAt
	}
	return nil
}

func (f *fakeSessionStore) RevokeSession(id, reason string) error {
	if s, ok := f.sessions[id]; ok {
		now := time.Now().UTC()
		s.RevokedAt = &now
		s.RevokedReason = reason
	}
	return nil
}

func (f *fakeSessionStore) RevokeFamily(familyID, reason string) error {
	now := time.Now().UTC()
	for _, s := range f.sessions {
		if s.FamilyID == familyID && s.RevokedAt == nil {
			s.RevokedAt = &now
			s.RevokedReason = reason
		}
	}
	return nil
}

func (f *fakeSessionStore) RevokeAllForUser(userID, reason string) (int, error) {
	now := time.Now().UTC()
	n := 0
	for _, s := range f.sessions {
		if s.UserID == userID && s.RevokedAt == nil {
			s.RevokedAt = &now
			s.RevokedReason = reason
			n++
		}
	}
	return n, nil
}

func (f *fakeSessionStore) TouchLastSeen(id string, at time.Time) error {
	if s, ok := f.sessions[id]; ok {
		s.LastSeenAt = &at
	}
	return nil
}

func (f *fakeSessionStore) CountRecentFailedLogins(email string, since time.Time) (int, error) {
	return f.failedCount, nil
}
func (f *fakeSessionStore) LastSuccessfulLogin(email string) (*LoginActivity, error) {
	return f.lastSuccess, nil
}
func (f *fakeSessionStore) HasKnownDevice(userID, fp string) (bool, error) {
	return f.knownDevices[userID+"|"+fp], nil
}
func (f *fakeSessionStore) HasKnownIP(userID, ip string) (bool, error) {
	return f.knownIPs[userID+"|"+ip], nil
}
func (f *fakeSessionStore) RecordSecurityEvent(e SecurityEvent) error {
	f.securityEvents = append(f.securityEvents, e)
	return nil
}
func (f *fakeSessionStore) SetForceFlags(userID string, reset, reverify bool) error {
	f.forceFlags[userID] = [2]bool{reset, reverify}
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// fake notifier records calls.
type fakeNotifier struct{ calls []string }

func (n *fakeNotifier) NotifySuspiciousLogin(userID, email, eventType string, signals map[string]any) {
	n.calls = append(n.calls, eventType)
}

// fake audit (no-op recorder).
type fakeAudit struct{ actions []string }

func (a *fakeAudit) LogAction(actor, target, action, module, rt, rid string, ov, nv map[string]any, ip, ua, sev string) {
	a.actions = append(a.actions, action)
}

func testCfg() config.Config {
	return config.Config{
		FeatureSessionHardeningEnabled: true,
		SuspiciousFailedLoginSpike:     3,
		SuspiciousImpossibleKmH:        800,
		SuspiciousEscalationPolicy:     "notify",
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────

func TestRefreshRotationIssuesNewTokenAndInvalidatesPrior(t *testing.T) {
	store := newFakeStore()
	svc := NewSessionService(store, &fakeNotifier{}, &fakeAudit{}, testCfg())

	_, err := svc.IssueSession("u1", IssuedTokens{AccessToken: "a0", RefreshToken: "r0", ExpiresIn: 3600}, LoginContext{})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	// Rotate r0 -> r1.
	sess, err := svc.RotateRefresh("r0", IssuedTokens{AccessToken: "a1", RefreshToken: "r1", ExpiresIn: 3600}, LoginContext{})
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if sess.RotationCounter != 1 {
		t.Fatalf("expected counter 1, got %d", sess.RotationCounter)
	}
	// The old token must no longer resolve as a current refresh hash.
	if got, _ := store.GetByRefreshHash(HashToken("r0")); got != nil {
		t.Fatalf("old refresh token should no longer be current")
	}
	if got, _ := store.GetByRefreshHash(HashToken("r1")); got == nil {
		t.Fatalf("new refresh token should be current")
	}
}

func TestRefreshReuseRevokesFamily(t *testing.T) {
	store := newFakeStore()
	notifier := &fakeNotifier{}
	svc := NewSessionService(store, notifier, &fakeAudit{}, testCfg())

	_, _ = svc.IssueSession("u1", IssuedTokens{AccessToken: "a0", RefreshToken: "r0", ExpiresIn: 3600}, LoginContext{})
	if _, err := svc.RotateRefresh("r0", IssuedTokens{AccessToken: "a1", RefreshToken: "r1", ExpiresIn: 3600}, LoginContext{}); err != nil {
		t.Fatalf("rotate: %v", err)
	}
	// Attacker replays the already-rotated r0.
	if _, err := svc.RotateRefresh("r0", IssuedTokens{AccessToken: "ax", RefreshToken: "rx", ExpiresIn: 3600}, LoginContext{}); err == nil {
		t.Fatalf("expected reuse error")
	}
	// The whole family must be revoked: r1 no longer usable.
	if _, err := svc.RotateRefresh("r1", IssuedTokens{AccessToken: "a2", RefreshToken: "r2", ExpiresIn: 3600}, LoginContext{}); err == nil {
		t.Fatalf("expected family-revoked error after reuse")
	}
	found := false
	for _, e := range store.securityEvents {
		if e.EventType == EventTokenReuse {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected token_reuse security event")
	}
}

func TestValidateAccessRejectsRevokedSession(t *testing.T) {
	store := newFakeStore()
	svc := NewSessionService(store, &fakeNotifier{}, &fakeAudit{}, testCfg())

	id, _ := svc.IssueSession("u1", IssuedTokens{AccessToken: "acc", RefreshToken: "r0", ExpiresIn: 3600}, LoginContext{})
	if _, err := svc.ValidateAccess("acc"); err != nil {
		t.Fatalf("active session should validate: %v", err)
	}
	_ = store.RevokeSession(id, "test")
	if _, err := svc.ValidateAccess("acc"); err == nil {
		t.Fatalf("revoked session must fail validation (fail-closed)")
	}
}

func TestRevokeAllKillsSiblingSessions(t *testing.T) {
	store := newFakeStore()
	svc := NewSessionService(store, &fakeNotifier{}, &fakeAudit{}, testCfg())

	_, _ = svc.IssueSession("u1", IssuedTokens{AccessToken: "a1", RefreshToken: "r1", ExpiresIn: 3600}, LoginContext{})
	_, _ = svc.IssueSession("u1", IssuedTokens{AccessToken: "a2", RefreshToken: "r2", ExpiresIn: 3600}, LoginContext{})
	_, _ = svc.IssueSession("u2", IssuedTokens{AccessToken: "b1", RefreshToken: "rb", ExpiresIn: 3600}, LoginContext{})

	n, err := svc.RevokeAll("admin", "u1", "test")
	if err != nil {
		t.Fatalf("revoke all: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 revoked, got %d", n)
	}
	if _, err := svc.ValidateAccess("a1"); err == nil {
		t.Fatalf("u1 session a1 should be revoked")
	}
	if _, err := svc.ValidateAccess("b1"); err != nil {
		t.Fatalf("u2 session must remain active: %v", err)
	}
}

func TestSuspiciousLoginNewDeviceTriggersEventAndNotification(t *testing.T) {
	store := newFakeStore()
	notifier := &fakeNotifier{}
	svc := NewSessionService(store, notifier, &fakeAudit{}, testCfg())

	events, err := svc.EvaluateLogin("u1", "user@example.com", LoginContext{DeviceFingerprint: "new-device", IPAddress: "1.2.3.4"})
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if len(events) == 0 {
		t.Fatalf("expected suspicious events for new device + new ip")
	}
	if len(notifier.calls) == 0 {
		t.Fatalf("expected a notification on suspicious login")
	}
	if len(store.securityEvents) == 0 {
		t.Fatalf("expected security events persisted")
	}
}

func TestSuspiciousLoginForceResetPolicyRevokesSessions(t *testing.T) {
	store := newFakeStore()
	notifier := &fakeNotifier{}
	cfg := testCfg()
	cfg.SuspiciousEscalationPolicy = PolicyForceReset
	svc := NewSessionService(store, notifier, &fakeAudit{}, cfg)

	// Existing active session.
	_, _ = svc.IssueSession("u1", IssuedTokens{AccessToken: "a1", RefreshToken: "r1", ExpiresIn: 3600}, LoginContext{})

	_, err := svc.EvaluateLogin("u1", "user@example.com", LoginContext{DeviceFingerprint: "evil", IPAddress: "9.9.9.9"})
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if got := store.forceFlags["u1"]; !got[0] {
		t.Fatalf("expected force_password_reset flag set")
	}
	if _, err := svc.ValidateAccess("a1"); err == nil {
		t.Fatalf("force-reset policy must revoke active sessions")
	}
}

func TestKnownDeviceAndIPDoesNotFlag(t *testing.T) {
	store := newFakeStore()
	store.knownDevices["u1|trusted"] = true
	store.knownIPs["u1|1.1.1.1"] = true
	svc := NewSessionService(store, &fakeNotifier{}, &fakeAudit{}, testCfg())

	events, err := svc.EvaluateLogin("u1", "user@example.com", LoginContext{DeviceFingerprint: "trusted", IPAddress: "1.1.1.1"})
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("known device+ip should not raise events, got %d", len(events))
	}
}

func TestFailedLoginSpikeFlags(t *testing.T) {
	store := newFakeStore()
	store.knownDevices["u1|trusted"] = true
	store.knownIPs["u1|1.1.1.1"] = true
	store.failedCount = 5
	svc := NewSessionService(store, &fakeNotifier{}, &fakeAudit{}, testCfg())

	events, _ := svc.EvaluateLogin("u1", "user@example.com", LoginContext{DeviceFingerprint: "trusted", IPAddress: "1.1.1.1"})
	found := false
	for _, e := range events {
		if e.EventType == EventFailedSpike {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected failed_login_spike event")
	}
}

func TestImpossibleTravelFlags(t *testing.T) {
	store := newFakeStore()
	store.knownDevices["u1|trusted"] = true
	store.knownIPs["u1|1.1.1.1"] = true
	// Last login in Lagos 1 hour ago.
	store.lastSuccess = &LoginActivity{Latitude: 6.5244, Longitude: 3.3792, CreatedAt: time.Now().UTC().Add(-1 * time.Hour)}
	svc := NewSessionService(store, &fakeNotifier{}, &fakeAudit{}, testCfg())

	// New login in London (~5000km) within 1 hour => impossible.
	events, _ := svc.EvaluateLogin("u1", "user@example.com", LoginContext{
		DeviceFingerprint: "trusted", IPAddress: "1.1.1.1", Latitude: 51.5074, Longitude: -0.1278,
	})
	found := false
	for _, e := range events {
		if e.EventType == EventImpossibleTravel {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected impossible_travel event")
	}
}

func TestRevokeOneRejectsForeignSession(t *testing.T) {
	store := newFakeStore()
	svc := NewSessionService(store, &fakeNotifier{}, &fakeAudit{}, testCfg())
	id, _ := svc.IssueSession("owner", IssuedTokens{AccessToken: "a", RefreshToken: "r", ExpiresIn: 3600}, LoginContext{})
	if err := svc.RevokeOne("attacker", "attacker", id, "test"); err == nil {
		t.Fatalf("expected object-level authz rejection")
	}
	// Owner can revoke own session.
	if err := svc.RevokeOne("owner", "owner", id, "test"); err != nil {
		t.Fatalf("owner revoke should succeed: %v", err)
	}
}
