package credential

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// These tests exercise the pure, deterministic credential primitives: HMAC token
// signing/verification (the forgery + wrong-secret defence) and the rotating
// window bucketing (the anti-screenshot / stale-window defence). The DB-backed
// lifecycle methods (Issue/Validate/Revoke/Reconcile, single-use consume, the
// ACTIVE->USED/REVOKED/EXPIRED state machine) require a live *pgxpool.Pool and are
// intentionally not covered here — see the report note.

// newCred is a synthetic in-memory credential; no DB involved.
func newCred(id, secret string, rotate time.Duration) *Credential {
	return &Credential{
		ID:     id,
		Secret: secret,
		State:  StateActive,
		Policy: Policy{RotateTTL: rotate},
	}
}

func TestSign(t *testing.T) {
	const (
		secret = "s3cr3t-signing-key"
		cid    = "cred-123"
		nonce  = "nonce-abc"
	)
	window := int64(42)
	base := sign(secret, cid, window, nonce)

	t.Run("deterministic for identical inputs", func(t *testing.T) {
		if got := sign(secret, cid, window, nonce); got != base {
			t.Fatalf("sign not deterministic: %q != %q", got, base)
		}
	})

	t.Run("output is valid hex of sha256 length", func(t *testing.T) {
		if _, err := hex.DecodeString(base); err != nil {
			t.Fatalf("signature is not valid hex: %v", err)
		}
		// HMAC-SHA256 => 32 bytes => 64 hex chars.
		if len(base) != 64 {
			t.Fatalf("expected 64 hex chars, got %d", len(base))
		}
	})

	t.Run("differs when any bound field changes", func(t *testing.T) {
		cases := map[string]string{
			"different secret": sign("other-secret", cid, window, nonce),
			"different cid":    sign(secret, "cred-999", window, nonce),
			"different window": sign(secret, cid, window+1, nonce),
			"different nonce":  sign(secret, cid, window, "nonce-xyz"),
		}
		for name, got := range cases {
			if got == base {
				t.Errorf("%s: signature collided with base %q", name, base)
			}
		}
	})
}

func TestVerifyToken(t *testing.T) {
	c := newCred("cred-abc", "top-secret", defaultRotateTTL)
	valid := *mintToken(c, time.Now())

	t.Run("valid token verifies", func(t *testing.T) {
		if !verifyToken(c, valid) {
			t.Fatal("freshly minted token failed verification")
		}
	})

	t.Run("tampered signature rejected", func(t *testing.T) {
		bad := valid
		// Flip the last hex char to guarantee a different, still-hex signature.
		last := bad.Sig[len(bad.Sig)-1]
		repl := byte('0')
		if last == '0' {
			repl = '1'
		}
		bad.Sig = bad.Sig[:len(bad.Sig)-1] + string(repl)
		if verifyToken(c, bad) {
			t.Fatal("tampered signature was accepted")
		}
	})

	t.Run("empty signature rejected", func(t *testing.T) {
		bad := valid
		bad.Sig = ""
		if verifyToken(c, bad) {
			t.Fatal("empty signature was accepted")
		}
	})

	t.Run("wrong secret rejected", func(t *testing.T) {
		// Same id, different signing secret: the token was signed by another key.
		other := newCred(c.ID, "different-secret", defaultRotateTTL)
		if verifyToken(other, valid) {
			t.Fatal("token verified against the wrong secret")
		}
	})

	t.Run("altered window rejected (replay across windows)", func(t *testing.T) {
		bad := valid
		bad.Window = valid.Window + 1
		if verifyToken(c, bad) {
			t.Fatal("token with altered window was accepted")
		}
	})

	t.Run("altered nonce rejected", func(t *testing.T) {
		bad := valid
		bad.Nonce = valid.Nonce + "x"
		if verifyToken(c, bad) {
			t.Fatal("token with altered nonce was accepted")
		}
	})

	t.Run("altered credential id rejected", func(t *testing.T) {
		bad := valid
		bad.CredentialID = "cred-forged"
		if verifyToken(c, bad) {
			t.Fatal("token with altered credential id was accepted")
		}
	})
}

func TestMintTokenRoundTrip(t *testing.T) {
	c := newCred("cred-round", "round-secret", defaultRotateTTL)
	now := time.Unix(1_700_000_000, 0)

	t.Run("minted token binds current window and self-verifies", func(t *testing.T) {
		tok := mintToken(c, now)
		if tok.CredentialID != c.ID {
			t.Fatalf("token cid = %q, want %q", tok.CredentialID, c.ID)
		}
		if tok.Window != windowFor(c, now) {
			t.Fatalf("token window = %d, want %d", tok.Window, windowFor(c, now))
		}
		if tok.Nonce == "" {
			t.Fatal("token nonce is empty")
		}
		if !verifyToken(c, *tok) {
			t.Fatal("minted token did not verify against its own credential")
		}
	})

	t.Run("nonce is fresh per mint", func(t *testing.T) {
		a := mintToken(c, now)
		b := mintToken(c, now)
		if a.Nonce == b.Nonce {
			t.Fatal("two mints produced identical nonces")
		}
	})
}

func TestWindowFor(t *testing.T) {
	t.Run("floor of unix over ttl seconds", func(t *testing.T) {
		c := newCred("c", "s", 30*time.Second)
		now := time.Unix(1000, 0) // 1000 / 30 = 33
		if got := windowFor(c, now); got != 33 {
			t.Fatalf("windowFor = %d, want 33", got)
		}
	})

	t.Run("falls back to default ttl when non-positive", func(t *testing.T) {
		c := newCred("c", "s", 0)
		now := time.Unix(1000, 0)
		want := now.Unix() / int64(defaultRotateTTL.Seconds())
		if got := windowFor(c, now); got != want {
			t.Fatalf("windowFor with zero ttl = %d, want %d (default ttl)", got, want)
		}
	})

	t.Run("window is stable within a bucket and advances across it", func(t *testing.T) {
		ttl := 30 * time.Second
		c := newCred("c", "s", ttl)
		base := time.Unix(1_700_000_040, 0) // exact multiple of 30
		w0 := windowFor(c, base)
		if w1 := windowFor(c, base.Add(ttl-time.Second)); w1 != w0 {
			t.Fatalf("window changed within bucket: %d -> %d", w0, w1)
		}
		if wn := windowFor(c, base.Add(ttl)); wn != w0+1 {
			t.Fatalf("window did not advance after ttl: got %d, want %d", wn, w0+1)
		}
	})

	t.Run("stale screenshot lands in an earlier bucket", func(t *testing.T) {
		// Models the anti-screenshot check in Validate: a token minted two windows
		// ago is neither the current nor the immediately-previous bucket.
		ttl := 30 * time.Second
		c := newCred("c", "s", ttl)
		now := time.Unix(1_700_000_100, 0)
		old := now.Add(-2 * ttl)
		cur := windowFor(c, now)
		stale := windowFor(c, old)
		if stale == cur || stale == cur-1 {
			t.Fatalf("stale window %d should be older than cur-1 (%d)", stale, cur-1)
		}
	})
}

func TestRandHex(t *testing.T) {
	t.Run("length is twice the byte count and is valid hex", func(t *testing.T) {
		s := randHex(16)
		if len(s) != 32 {
			t.Fatalf("randHex(16) len = %d, want 32", len(s))
		}
		if _, err := hex.DecodeString(s); err != nil {
			t.Fatalf("randHex output not valid hex: %v", err)
		}
	})

	t.Run("successive calls differ", func(t *testing.T) {
		if randHex(16) == randHex(16) {
			t.Fatal("two randHex calls returned identical values")
		}
	})
}

func TestNullTime(t *testing.T) {
	t.Run("zero time maps to nil", func(t *testing.T) {
		if got := nullTime(time.Time{}); got != nil {
			t.Fatalf("nullTime(zero) = %v, want nil", got)
		}
	})

	t.Run("non-zero time passes through", func(t *testing.T) {
		ts := time.Unix(1_700_000_000, 0)
		got := nullTime(ts)
		gotTime, ok := got.(time.Time)
		if !ok {
			t.Fatalf("nullTime(non-zero) type = %T, want time.Time", got)
		}
		if !gotTime.Equal(ts) {
			t.Fatalf("nullTime(non-zero) = %v, want %v", gotTime, ts)
		}
	})
}

func TestStateAndReasonConstants(t *testing.T) {
	// Guards the stable audit/state string contract the offline gate and clients
	// depend on; a rename here is a breaking wire change.
	states := map[State]string{
		StateActive:  "ACTIVE",
		StateUsed:    "USED",
		StateRevoked: "REVOKED",
		StateExpired: "EXPIRED",
	}
	for s, want := range states {
		if string(s) != want {
			t.Errorf("state %v = %q, want %q", s, string(s), want)
		}
	}

	reasons := []string{
		ReasonReplay, ReasonExpired, ReasonNotYetValid,
		ReasonBadSig, ReasonStaleWindow, ReasonRevoked, ReasonNotFound,
	}
	seen := map[string]bool{}
	for _, r := range reasons {
		if r == "" || strings.TrimSpace(r) != r {
			t.Errorf("reason %q is empty or has surrounding whitespace", r)
		}
		if seen[r] {
			t.Errorf("duplicate reason string %q", r)
		}
		seen[r] = true
	}
}
