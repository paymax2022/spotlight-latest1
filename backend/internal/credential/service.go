package credential

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the minimal slice of services.AuditService the credential core needs
// (NL-12). It is satisfied by the immutable audit service; nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service issues and validates rotating-QR / NFC credentials. It is a shared
// primitive reused by events (ticket gate entry, vendor POS-lite, wallet band) and
// loyalty (perk redemption). All money lives in finance/escrow; this package only
// proves identity + single-use. Every accepted scan is appended (NL-8 style audit
// trail) and replay is rejected (QR single-use invariant).
type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service {
	return &Service{db: db, audit: audit}
}

const defaultRotateTTL = 30 * time.Second

// Issue mints a credential for subjectRef. The returned Credential carries a fresh
// signing secret + (for tap) an NFC token. The QR is NOT returned here — call
// CurrentToken to get the rotating value each render so screenshots go stale.
func (s *Service) Issue(ctx context.Context, subjectRef string, kind Kind, policy Policy) (*Credential, error) {
	if subjectRef == "" {
		return nil, fmt.Errorf("credential: subjectRef required")
	}
	if policy.RotateTTL <= 0 {
		policy.RotateTTL = defaultRotateTTL
	}
	if policy.ValidFrom.IsZero() {
		policy.ValidFrom = time.Now()
	}
	c := &Credential{
		ID:         uuid.New().String(),
		SubjectRef: subjectRef,
		Kind:       kind,
		State:      StateActive,
		Secret:     randHex(32),
		Policy:     policy,
		NFCToken:   randHex(24),
		IssuedAt:   time.Now(),
	}
	const ins = `
		INSERT INTO credentials
		  (id, subject_ref, kind, state, secret, nfc_token,
		   single_use, allow_reentry, reentry_window_secs, rotate_ttl_secs, valid_from, valid_to)
		VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$9,$10,$11)`
	if _, err := s.db.Exec(ctx, ins,
		c.ID, c.SubjectRef, string(c.Kind), c.Secret, c.NFCToken,
		policy.SingleUse, policy.AllowReentry,
		int64(policy.ReentryWindow.Seconds()), int64(policy.RotateTTL.Seconds()),
		policy.ValidFrom, nullTime(policy.ValidTo),
	); err != nil {
		return nil, fmt.Errorf("credential: insert: %w", err)
	}
	s.log(subjectRef, "credential.issue", c.ID, map[string]any{"kind": string(kind)})
	return c, nil
}

// CurrentToken returns the rotating signed token for the current window. The client
// re-fetches each RotateTTL so a captured QR screenshot is only valid until the
// window flips (anti-screenshot). The signature binds the window, so an old token
// fails the staleness + signature checks even if leaked.
func (s *Service) CurrentToken(ctx context.Context, credentialID string) (*Token, error) {
	c, err := s.load(ctx, credentialID)
	if err != nil {
		return nil, err
	}
	if c.State != StateActive {
		return nil, fmt.Errorf("credential: not active (%s)", c.State)
	}
	return mintToken(c, time.Now()), nil
}

// Validate verifies a presented token at a gate and enforces single-use / re-entry.
// Replay is rejected: for a single-use credential the first ACCEPT flips state to
// USED (guarded UPDATE), so a second scan of the same (or any) window is rejected
// as ReasonReplay. For a stale window (older bucket than now) the scan is rejected
// even with a valid signature — that defeats screenshots shared after the fact.
func (s *Service) Validate(ctx context.Context, tok Token, gate Gate) (*Result, error) {
	c, err := s.load(ctx, tok.CredentialID)
	if err != nil {
		return s.reject(ctx, tok, gate, ReasonNotFound), nil
	}

	now := time.Now()
	res := &Result{CredentialID: c.ID, SubjectRef: c.SubjectRef, Kind: c.Kind}

	// State guards.
	switch c.State {
	case StateRevoked:
		return s.reject(ctx, tok, gate, ReasonRevoked), nil
	case StateExpired:
		return s.reject(ctx, tok, gate, ReasonExpired), nil
	case StateUsed:
		if !c.Policy.AllowReentry {
			return s.reject(ctx, tok, gate, ReasonReplay), nil
		}
	}

	// Time-window guards.
	if now.Before(c.Policy.ValidFrom) {
		return s.reject(ctx, tok, gate, ReasonNotYetValid), nil
	}
	if !c.Policy.ValidTo.IsZero() && now.After(c.Policy.ValidTo) {
		_ = s.expire(ctx, c.ID)
		return s.reject(ctx, tok, gate, ReasonExpired), nil
	}

	// Signature must verify against the credential secret.
	if !verifyToken(c, tok) {
		return s.reject(ctx, tok, gate, ReasonBadSig), nil
	}

	// Anti-screenshot: the presented window must be the current (or immediately
	// previous, to tolerate clock skew at the scanner) rotation bucket. An older
	// screenshot lands in a stale bucket and is rejected.
	curWindow := windowFor(c, now)
	if tok.Window != curWindow && tok.Window != curWindow-1 {
		return s.reject(ctx, tok, gate, ReasonStaleWindow), nil
	}

	// Re-entry dedupe: within the re-entry window, a repeat scan at the SAME gate is
	// accepted idempotently but recorded as a re-entry rather than a fresh use.
	if c.Policy.AllowReentry {
		if recent, _ := s.recentAccept(ctx, c.ID, gate.ID, c.Policy.ReentryWindow); recent {
			res.OK = true
			res.Reentry = true
			s.appendValidation(ctx, c.ID, gate.ID, tok.Window, "ACCEPTED", "reentry")
			return res, nil
		}
	}

	// Single-use consume: guarded transition ACTIVE -> USED. The conditional UPDATE
	// is the replay defence — exactly one scanner can win the row, all others see 0
	// rows affected and are rejected as replays.
	if c.Policy.SingleUse {
		consumed, err := s.consume(ctx, c.ID)
		if err != nil {
			return nil, err
		}
		if !consumed {
			return s.reject(ctx, tok, gate, ReasonReplay), nil
		}
	}

	res.OK = true
	s.appendValidation(ctx, c.ID, gate.ID, tok.Window, "ACCEPTED", "")
	s.log(c.SubjectRef, "credential.validate", c.ID, map[string]any{"gate": gate.ID, "kind": string(c.Kind)})
	return res, nil
}

// EnqueueOffline records a PENDING scan when the gate is briefly offline: it stores
// the presented token + gate so Reconcile can re-run Validate against the signed
// token once connectivity returns. Offline-tolerant: an entry event is never lost.
func (s *Service) EnqueueOffline(ctx context.Context, tok Token, gate Gate) error {
	const ins = `
		INSERT INTO credential_validations (id, credential_id, gate_id, window_bucket, outcome, reason, scanned_at)
		VALUES ($1,$2,$3,$4,'PENDING','offline_queued',now())`
	_, err := s.db.Exec(ctx, ins, uuid.New().String(), tok.CredentialID, gate.ID, tok.Window)
	return err
}

// Reconcile drains PENDING offline scans and resolves each against Validate. A
// PENDING scan that wins single-use consumption becomes ACCEPTED; a duplicate
// becomes REJECTED(replay). Returns the count reconciled.
func (s *Service) Reconcile(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const sel = `SELECT id, credential_id, gate_id, window_bucket
	             FROM credential_validations WHERE outcome='PENDING'
	             ORDER BY scanned_at ASC LIMIT $1`
	rows, err := s.db.Query(ctx, sel, limit)
	if err != nil {
		return 0, err
	}
	type pend struct {
		id, cid, gid string
		w            int64
	}
	var batch []pend
	for rows.Next() {
		var p pend
		if err := rows.Scan(&p.id, &p.cid, &p.gid, &p.w); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	n := 0
	for _, p := range batch {
		c, err := s.load(ctx, p.cid)
		if err != nil {
			s.resolvePending(ctx, p.id, "REJECTED", ReasonNotFound)
			n++
			continue
		}
		outcome, reason := "ACCEPTED", ""
		if c.Policy.SingleUse {
			consumed, err := s.consume(ctx, c.ID)
			if err != nil {
				return n, err
			}
			if !consumed {
				outcome, reason = "REJECTED", ReasonReplay
			}
		}
		s.resolvePending(ctx, p.id, outcome, reason)
		n++
	}
	return n, nil
}

// Revoke flips an active credential to REVOKED (organiser/admin action).
func (s *Service) Revoke(ctx context.Context, credentialID string) error {
	const q = `UPDATE credentials SET state='REVOKED' WHERE id=$1 AND state='ACTIVE'`
	ct, err := s.db.Exec(ctx, q, credentialID)
	if err != nil {
		return fmt.Errorf("credential: revoke: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("credential: not revocable (missing or terminal)")
	}
	s.log("", "credential.revoke", credentialID, nil)
	return nil
}

// --- internals ---

func (s *Service) consume(ctx context.Context, id string) (bool, error) {
	const q = `UPDATE credentials SET state='USED', used_at=now() WHERE id=$1 AND state='ACTIVE'`
	ct, err := s.db.Exec(ctx, q, id)
	if err != nil {
		return false, fmt.Errorf("credential: consume: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

func (s *Service) expire(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE credentials SET state='EXPIRED' WHERE id=$1 AND state='ACTIVE'`, id)
	return err
}

func (s *Service) recentAccept(ctx context.Context, credentialID, gateID string, window time.Duration) (bool, error) {
	if window <= 0 {
		window = 5 * time.Minute
	}
	const q = `SELECT EXISTS(
		SELECT 1 FROM credential_validations
		WHERE credential_id=$1 AND gate_id=$2 AND outcome='ACCEPTED'
		  AND scanned_at >= now() - ($3 || ' seconds')::interval)`
	var ok bool
	err := s.db.QueryRow(ctx, q, credentialID, gateID, int64(window.Seconds())).Scan(&ok)
	return ok, err
}

func (s *Service) appendValidation(ctx context.Context, credentialID, gateID string, window int64, outcome, reason string) {
	const ins = `
		INSERT INTO credential_validations (id, credential_id, gate_id, window_bucket, outcome, reason, scanned_at)
		VALUES ($1,$2,$3,$4,$5,$6,now())`
	_, _ = s.db.Exec(ctx, ins, uuid.New().String(), credentialID, gateID, window, outcome, reason)
}

func (s *Service) resolvePending(ctx context.Context, id, outcome, reason string) {
	_, _ = s.db.Exec(ctx, `UPDATE credential_validations SET outcome=$2, reason=$3 WHERE id=$1`, id, outcome, reason)
}

func (s *Service) reject(ctx context.Context, tok Token, gate Gate, reason string) *Result {
	s.appendValidation(ctx, tok.CredentialID, gate.ID, tok.Window, "REJECTED", reason)
	return &Result{OK: false, CredentialID: tok.CredentialID, Reason: reason}
}

func (s *Service) load(ctx context.Context, id string) (*Credential, error) {
	const q = `
		SELECT id, subject_ref, kind, state, secret, nfc_token,
		       single_use, allow_reentry, reentry_window_secs, rotate_ttl_secs, valid_from, valid_to, issued_at
		FROM credentials WHERE id=$1`
	var c Credential
	var kind, state string
	var reentrySecs, rotateSecs int64
	var validTo *time.Time
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&c.ID, &c.SubjectRef, &kind, &state, &c.Secret, &c.NFCToken,
		&c.Policy.SingleUse, &c.Policy.AllowReentry, &reentrySecs, &rotateSecs,
		&c.Policy.ValidFrom, &validTo, &c.IssuedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("credential: not found")
		}
		return nil, fmt.Errorf("credential: load: %w", err)
	}
	c.Kind = Kind(kind)
	c.State = State(state)
	c.Policy.ReentryWindow = time.Duration(reentrySecs) * time.Second
	c.Policy.RotateTTL = time.Duration(rotateSecs) * time.Second
	if validTo != nil {
		c.Policy.ValidTo = *validTo
	}
	return &c, nil
}

func (s *Service) log(subject, action, id string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(subject, "", action, "credential", "credential", id, nil, meta, "", "", "info")
}

// --- token crypto (pure functions, deterministic per window) ---

func windowFor(c *Credential, now time.Time) int64 {
	ttl := c.Policy.RotateTTL
	if ttl <= 0 {
		ttl = defaultRotateTTL
	}
	return now.Unix() / int64(ttl.Seconds())
}

func mintToken(c *Credential, now time.Time) *Token {
	w := windowFor(c, now)
	nonce := randHex(8)
	return &Token{
		CredentialID: c.ID,
		Window:       w,
		Nonce:        nonce,
		Sig:          sign(c.Secret, c.ID, w, nonce),
	}
}

func verifyToken(c *Credential, tok Token) bool {
	want := sign(c.Secret, tok.CredentialID, tok.Window, tok.Nonce)
	return hmac.Equal([]byte(want), []byte(tok.Sig))
}

func sign(secret, cid string, window int64, nonce string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%s|%d|%s", cid, window, nonce)
	return hex.EncodeToString(mac.Sum(nil))
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
