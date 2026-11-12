# LiveKit Health Consults — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared consult engine (packages, sessions, server-authoritative timers, approve-then-pay extensions, session chat) and the prefix-guarded LiveKit rail, with no UI changes and no behaviour change until a module starts a session.

**Architecture:** A new `internal/health/consultengine` package owns the four `consult_*` tables and all lifecycle rules; it talks to media and money through two narrow interfaces. `internal/app/consult_livekit.go` adapts the existing `*livekit.Client` (new `RolePeer` / `RolePeerAdmin` grants), and `internal/app/consult_routes.go` exposes bearer-authenticated JSON routes under `/api/v1/consult`. `RegisterConsult` is wired once in `registerFinanceRoutes`; a 30-second sweeper is the timer backstop.

**Tech Stack:** Go 1.2x, gin, pgx/v5, LiveKit server SDK (`internal/integrations/livekit`), existing `escrow` + `ledger` money rail, Postgres migrations under `supabase/migrations`.

**Spec:** `docs/superpowers/specs/2026-11-04-livekit-health-consults-design.md`

## Global Constraints

- Migration is additive only: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`; no `DROP`, no column narrowing. Wrap in `BEGIN; … COMMIT;`.
- New tables get `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and **no** anon/authenticated policies; access only through the Go pool (health-platform convention).
- Media fails closed: `FEATURE_LIVEKIT_ENABLED` on but client unusable ⇒ `503` sentinel, never a token for a room the rail did not create.
- All money amounts are computed server-side in kobo; a client-supplied price is ignored.
- Non-participants get `404` for every session path — never `403` (do not confirm existence).
- Room names are `consult-<vertical>-<session uuid>`; the rail refuses any name without the `consult-` prefix.
- Every task ends with `go build ./... && go vet ./...` green; live-DB tests skip when `TEST_DATABASE_URL` is unset.
- Stage only files named in the task; never `frontend-web/node_modules`, never `frontend-admin/next-env.d.ts`.
- Work in the isolated worktree (this file lives in it). Where a step's command says `cd /Users/paymax/Documents/spotlight/main`, substitute the worktree root; commit there, never in the main checkout. The shell cwd resets after each command, so pass absolute paths.

## File Structure

```
supabase/migrations/20271405000000_consult_sessions.sql   schema (4 tables + indexes + RLS)
backend/internal/integrations/livekit/client.go           + RolePeer, RolePeerAdmin grants
backend/internal/integrations/livekit/livekit_test.go     + peer role grant tests
backend/internal/health/consultengine/types.go            domain types, sentinels, constants
backend/internal/health/consultengine/timing.go           pure clock/pricing math
backend/internal/health/consultengine/timing_test.go      pure tests
backend/internal/health/consultengine/service.go          deps, constructor, rows, views
backend/internal/health/consultengine/packages.go         publish/list packages
backend/internal/health/consultengine/sessions.go         Book/Get/Join/Complete/Sweep
backend/internal/health/consultengine/extensions.go       request/decide/pay/apply/release
backend/internal/health/consultengine/messages.go         post/list session chat
backend/internal/health/consultengine/engine_live_db_test.go  end-to-end lifecycle (gated)
backend/internal/app/consult_livekit.go                   rail + media selection + fail-closed
backend/internal/app/consult_livekit_test.go              rail tests
backend/internal/app/consult_routes.go                    handlers, error map, RegisterConsult
backend/internal/app/consult_routes_test.go               handler tests with a fake engine
backend/internal/app/finance_routes.go                    one hoisted LiveKit client + registration
```

---

### Task 1: Consult schema

**Files:**
- Create: `supabase/migrations/20271405000000_consult_sessions.sql`
- Test: fresh replay + RLS check (commands below)

**Interfaces:**
- Consumes: existing `auth.users`, `health_providers.owner_user_id`.
- Produces: tables `consult_session_packages`, `consult_sessions`, `consult_extension_requests`, `consult_session_messages` with the exact columns used by every later task.

- [ ] **Step 1: Confirm the migration version is still free**

Run: `ls supabase/migrations | tail -3` and `ls supabase/migrations | grep '^20271405' || true`.
Expected: `20271405000000_consult_sessions.sql` does not exist. (The repo may carry a newer uncommitted migration in another checkout; only the worktree's tree matters here.) If `20271405000000_consult_sessions.sql` already exists or a newer version that sorts after it was merged, bump the number by `10000` and use that filename everywhere in this task.

- [ ] **Step 2: Write the migration**

```sql
-- Paid consult sessions shared by telemedicine, vet, pharmacy and lab.
-- ADDITIVE-ONLY: four new tables, nothing existing altered.
-- RLS is enabled with NO anon/authenticated policies by design: every read and
-- write goes through the Go pool, which owns participant scoping.
BEGIN;

CREATE TABLE IF NOT EXISTS public.consult_session_packages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind        text NOT NULL CHECK (owner_kind IN ('doctor','health_provider')),
  owner_id          uuid NOT NULL,
  vertical          text NOT NULL CHECK (vertical IN ('telemedicine','vet','pharmacy','lab')),
  mode              text NOT NULL CHECK (mode IN ('chat','voice','video')),
  duration_minutes  int  NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  price_kobo        bigint NOT NULL CHECK (price_kobo BETWEEN 0 AND 100000000),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_packages_owner
  ON public.consult_session_packages (owner_kind, owner_id, vertical, mode, duration_minutes);
CREATE INDEX IF NOT EXISTS idx_consult_packages_lookup
  ON public.consult_session_packages (vertical, owner_kind, owner_id, active);

CREATE TABLE IF NOT EXISTS public.consult_sessions (
  id                   uuid PRIMARY KEY,
  vertical             text NOT NULL CHECK (vertical IN ('telemedicine','vet','pharmacy','lab')),
  mode                 text NOT NULL CHECK (mode IN ('chat','voice','video')),
  patient_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_owner_kind  text NOT NULL CHECK (provider_owner_kind IN ('doctor','health_provider')),
  provider_owner_id    uuid NOT NULL,
  provider_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_ref           text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 200),
  package_id           uuid REFERENCES public.consult_session_packages(id) ON DELETE SET NULL,
  duration_minutes     int  NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  price_kobo           bigint NOT NULL CHECK (price_kobo BETWEEN 0 AND 100000000),
  booked_start         timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  warn_at              timestamptz NOT NULL,
  warning_sent_at      timestamptz,
  state                text NOT NULL DEFAULT 'scheduled'
                       CHECK (state IN ('scheduled','live','ended','cancelled')),
  room_name            text NOT NULL UNIQUE,
  base_hold_id         text,
  ended_at             timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > booked_start),
  CHECK (warn_at >= booked_start AND warn_at <= ends_at)
);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_patient
  ON public.consult_sessions (patient_id, booked_start DESC);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_provider
  ON public.consult_sessions (provider_user_id, booked_start DESC);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_due
  ON public.consult_sessions (state, ends_at);

CREATE TABLE IF NOT EXISTS public.consult_extension_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES public.consult_sessions(id) ON DELETE CASCADE,
  requested_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_minutes       int  NOT NULL CHECK (added_minutes BETWEEN 1 AND 240),
  price_kobo          bigint NOT NULL CHECK (price_kobo BETWEEN 0 AND 100000000),
  status              text NOT NULL CHECK (status IN
                        ('pending_approval','approved_awaiting_payment',
                         'paid','declined','expired','cancelled')),
  approved_at         timestamptz,
  payment_expires_at  timestamptz,
  paid_at             timestamptz,
  escrow_id           text,
  released_at         timestamptz,
  decided_by          uuid,
  decline_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_extension_open
  ON public.consult_extension_requests (session_id)
  WHERE status IN ('pending_approval','approved_awaiting_payment');
CREATE INDEX IF NOT EXISTS idx_consult_extension_unreleased
  ON public.consult_extension_requests (session_id, status, released_at);

CREATE TABLE IF NOT EXISTS public.consult_session_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.consult_sessions(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consult_messages_session
  ON public.consult_session_messages (session_id, created_at ASC);

ALTER TABLE public.consult_session_packages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consult_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consult_extension_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consult_session_messages    ENABLE ROW LEVEL SECURITY;

COMMIT;
```

- [ ] **Step 3: Apply it to the local database and replay from scratch**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main && supabase migration up --include-all
```
Expected: `Applying migration 20271405000000_consult_sessions.sql` and no error. Then:
```bash
psql "${TEST_DATABASE_URL:?set TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20271405000000_consult_sessions.sql
```
Expected: the file is idempotent, so it succeeds a second time.

- [ ] **Step 4: Verify RLS is on**

Run: `psql "$TEST_DATABASE_URL" -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'consult_%' ORDER BY relname;"`
Expected: four rows, `relrowsecurity = t` for all four.

- [ ] **Step 5: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add supabase/migrations/20271405000000_consult_sessions.sql
git commit -m "feat(db): add paid consult session tables"
```

---

### Task 2: Peer roles on the LiveKit client

**Files:**
- Modify: `backend/internal/integrations/livekit/client.go:21-28` (role constants), `:107-120` (`grantFor`)
- Test: `backend/internal/integrations/livekit/livekit_test.go` (append)

**Interfaces:**
- Consumes: existing `grantFor`, `JoinToken`.
- Produces: `livekit.RolePeer` and `livekit.RolePeerAdmin`; both publish audio/video/data and subscribe; the admin variant also carries `RoomAdmin`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/integrations/livekit/livekit_test.go`:

```go
func TestPeerRoleMayPublishSubscribeAndSendData(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	tok, err := c.JoinToken(JoinRequest{Room: "consult-vet-s1", Identity: "u1", Role: RolePeer})
	if err != nil {
		t.Fatalf("join token: %v", err)
	}
	v := verify(t, tok.JWT).Video
	if !isTrue(v.CanPublish) || !isTrue(v.CanSubscribe) || !isTrue(v.CanPublishData) {
		t.Fatalf("peer grants publish=%v subscribe=%v data=%v, want all true",
			isTrue(v.CanPublish), isTrue(v.CanSubscribe), isTrue(v.CanPublishData))
	}
	if v.RoomAdmin {
		t.Fatal("a plain peer must not be room admin")
	}
}

func TestPeerAdminRoleAlsoGetsRoomAdmin(t *testing.T) {
	c := newTestClient(t, "wss://rtc.example.com")
	tok, err := c.JoinToken(JoinRequest{Room: "consult-vet-s1", Identity: "doc", Role: RolePeerAdmin})
	if err != nil {
		t.Fatalf("join token: %v", err)
	}
	v := verify(t, tok.JWT).Video
	if !isTrue(v.CanPublish) || !isTrue(v.CanPublishData) || !v.RoomAdmin {
		t.Fatalf("peer admin grants publish=%v data=%v admin=%v, want all true",
			isTrue(v.CanPublish), isTrue(v.CanPublishData), v.RoomAdmin)
	}
}
```

The existing helper is `newTestClient(t *testing.T, url string)`; use it as the existing role test does (`newTestClient(t, "wss://rtc.example.com")`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/integrations/livekit/ -run 'TestPeer' -v`
Expected: compile error `undefined: RolePeer`.

- [ ] **Step 3: Add the roles and grants**

In `backend/internal/integrations/livekit/client.go`:

```go
	// RolePeer is one side of a 1:1 consult: publish audio/video, subscribe, send data.
	RolePeer Role = "peer"
	// RolePeerAdmin is RolePeer plus LiveKit room administration (the provider side).
	RolePeerAdmin Role = "peer_admin"
```

In `grantFor`:

```go
	case RolePeer:
		g.CanPublish, g.CanPublishData = boolp(true), boolp(true)
	case RolePeerAdmin:
		g.CanPublish, g.CanPublishData = boolp(true), boolp(true)
		g.RoomAdmin = true
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/integrations/livekit/ -v`
Expected: PASS, including the pre-existing role table.

- [ ] **Step 5: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/integrations/livekit/client.go backend/internal/integrations/livekit/livekit_test.go
git commit -m "feat(livekit): add peer roles for 1:1 consults"
```

---

### Task 3: Engine types and pure timing/pricing math

**Files:**
- Create: `backend/internal/health/consultengine/types.go`
- Create: `backend/internal/health/consultengine/timing.go`
- Test: `backend/internal/health/consultengine/timing_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types: `Mode`, `Vertical`, `State`, `ExtensionStatus`, `MediaRole`, `OwnerKind`, `Package`, `Session`, `Extension`, `Message`, `BookRequest`, `Join`, `RTC`.
  - Sentinels: `ErrNotFound`, `ErrInvalid`, `ErrState`, `ErrMediaUnavailable`, `ErrExtensionNotPayable`, `ErrPaymentExpired`, `ErrEscrowUnavailable`.
  - Constants: `MinDurationMinutes`, `MaxDurationMinutes`, `MaxExtensionMinutes`, `MaxSessionWindow`, `ExtensionPaymentWindow`, `WarningCap`, `DefaultJoinTTL`.
  - Functions: `WarnLead(time.Duration) time.Duration`, `WarnAt(start, ends time.Time) time.Time`, `ExtensionPriceKobo(priceKobo int64, durationMinutes, addedMinutes int) int64`, `JoinTTL(now, endsAt time.Time, configured time.Duration) time.Duration`.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/health/consultengine/timing_test.go`:

```go
package consultengine

import (
	"testing"
	"time"
)

func TestWarnLeadIsFiveMinutesOrAProportionalFifth(t *testing.T) {
	cases := []struct {
		window time.Duration
		want   time.Duration
	}{
		{30 * time.Minute, 5 * time.Minute},
		{25 * time.Minute, 5 * time.Minute},
		{20 * time.Minute, 4 * time.Minute},
		{10 * time.Minute, 2 * time.Minute},
		{5 * time.Minute, time.Minute},
		{0, 0},
	}
	for _, tc := range cases {
		if got := WarnLead(tc.window); got != tc.want {
			t.Errorf("WarnLead(%v) = %v, want %v", tc.window, got, tc.want)
		}
	}
}

func TestWarnAtAnchorsToTheBookedWindow(t *testing.T) {
	start := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	ends := start.Add(30 * time.Minute)
	if got, want := WarnAt(start, ends), start.Add(25*time.Minute); !got.Equal(want) {
		t.Fatalf("WarnAt = %v, want %v", got, want)
	}
}

func TestExtensionPriceCeilsToTheKobo(t *testing.T) {
	cases := []struct {
		price    int64
		duration int
		added    int
		want     int64
	}{
		{500_000, 30, 10, 166_667},
		{500_000, 30, 30, 500_000},
		{200_000, 20, 1, 10_000},
		{0, 30, 10, 0},
		{500_000, 0, 10, 0},
	}
	for _, tc := range cases {
		if got := ExtensionPriceKobo(tc.price, tc.duration, tc.added); got != tc.want {
			t.Errorf("ExtensionPriceKobo(%d,%d,%d) = %d, want %d",
				tc.price, tc.duration, tc.added, got, tc.want)
		}
	}
}

func TestJoinTTLIsCappedByTheRemainingSession(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	if got, want := JoinTTL(now, now.Add(20*time.Minute), 10*time.Minute), 10*time.Minute; got != want {
		t.Errorf("plenty of time: got %v, want %v", got, want)
	}
	if got, want := JoinTTL(now, now.Add(30*time.Second), 10*time.Minute), time.Minute; got != want {
		t.Errorf("almost over: got %v, want %v", got, want)
	}
	if got, want := JoinTTL(now, now.Add(90*time.Second), 10*time.Minute), 150*time.Second; got != want {
		t.Errorf("short session: got %v, want %v", got, want)
	}
	if got, want := JoinTTL(now, now.Add(20*time.Minute), 0), DefaultJoinTTL; got != want {
		t.Errorf("unconfigured ttl: got %v, want %v", got, want)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/health/consultengine/ -v`
Expected: build failure (`package consultengine` has no Go files, or undefined functions).

- [ ] **Step 3: Write the types**

Create `backend/internal/health/consultengine/types.go`:

```go
// Package consultengine owns paid, timed consult sessions shared by telemedicine,
// veterinary, pharmacy and lab. It knows nothing about any vertical's own tables:
// a session points at its origin through SourceRef, and the module keeps its
// appointment, base escrow hold and records.
package consultengine

import (
	"errors"
	"time"
)

type Mode string

const (
	ModeChat  Mode = "chat"
	ModeVoice Mode = "voice"
	ModeVideo Mode = "video"
)

type Vertical string

const (
	VerticalTelemedicine Vertical = "telemedicine"
	VerticalVet          Vertical = "vet"
	VerticalPharmacy     Vertical = "pharmacy"
	VerticalLab          Vertical = "lab"
)

type State string

const (
	StateScheduled State = "scheduled"
	StateLive      State = "live"
	StateEnded     State = "ended"
	StateCancelled State = "cancelled"
)

type ExtensionStatus string

const (
	ExtPending         ExtensionStatus = "pending_approval"
	ExtAwaitingPayment ExtensionStatus = "approved_awaiting_payment"
	ExtPaid            ExtensionStatus = "paid"
	ExtDeclined        ExtensionStatus = "declined"
	ExtExpired         ExtensionStatus = "expired"
	ExtCancelled       ExtensionStatus = "cancelled"
)

type MediaRole string

const (
	MediaPeer      MediaRole = "peer"
	MediaPeerAdmin MediaRole = "peer_admin"
)

type OwnerKind string

const (
	OwnerDoctor         OwnerKind = "doctor"
	OwnerHealthProvider OwnerKind = "health_provider"
)

var (
	ErrNotFound           = errors.New("consult: not found")
	ErrInvalid            = errors.New("consult: invalid input")
	ErrState              = errors.New("consult: invalid session state")
	ErrMediaUnavailable   = errors.New("consult: media unavailable")
	ErrExtensionNotPayable = errors.New("consult: extension is not awaiting payment")
	ErrPaymentExpired     = errors.New("consult: extension payment window expired")
	ErrEscrowUnavailable  = errors.New("consult: escrow unavailable")
)

const (
	MinDurationMinutes     = 5
	MaxDurationMinutes     = 480
	MaxExtensionMinutes    = 240
	MaxSessionWindow       = 4 * time.Hour
	ExtensionPaymentWindow = 5 * time.Minute
	WarningCap             = 5 * time.Minute
	DefaultJoinTTL         = 10 * time.Minute
)

type Package struct {
	ID              string    `json:"id"`
	OwnerKind       OwnerKind `json:"owner_kind"`
	OwnerID         string    `json:"owner_id"`
	Vertical        Vertical  `json:"vertical"`
	Mode            Mode      `json:"mode"`
	DurationMinutes int       `json:"duration_minutes"`
	PriceKobo       int64     `json:"price_kobo"`
	Active          bool      `json:"active"`
	CreatedAt       time.Time `json:"created_at"`
}

type Session struct {
	ID               string     `json:"id"`
	Vertical         Vertical   `json:"vertical"`
	Mode             Mode       `json:"mode"`
	PatientID        string     `json:"patient_id"`
	ProviderUserID   string     `json:"provider_user_id"`
	SourceRef        string     `json:"source_ref"`
	PackageID        *string    `json:"package_id,omitempty"`
	DurationMinutes  int        `json:"duration_minutes"`
	PriceKobo        int64      `json:"price_kobo"`
	BookedStart      time.Time  `json:"booked_start"`
	EndsAt           time.Time  `json:"ends_at"`
	WarnAt           time.Time  `json:"warn_at"`
	WarningSentAt    *time.Time `json:"warning_sent_at,omitempty"`
	State            State      `json:"state"`
	RoomName         string     `json:"room_name"`
	BaseHoldID       *string    `json:"base_hold_id,omitempty"`
	EndedAt          *time.Time `json:"ended_at,omitempty"`
	ServerNow        time.Time  `json:"server_now"`
	Extendable       bool       `json:"extendable"`
	ProviderOwnerKind OwnerKind `json:"provider_owner_kind"`
	ProviderOwnerID   string    `json:"provider_owner_id"`
}

type Extension struct {
	ID               string          `json:"id"`
	SessionID        string          `json:"session_id"`
	RequestedBy      string          `json:"requested_by"`
	AddedMinutes     int             `json:"added_minutes"`
	PriceKobo        int64           `json:"price_kobo"`
	Status           ExtensionStatus `json:"status"`
	ApprovedAt       *time.Time      `json:"approved_at,omitempty"`
	PaymentExpiresAt *time.Time      `json:"payment_expires_at,omitempty"`
	PaidAt           *time.Time      `json:"paid_at,omitempty"`
	EscrowID         *string         `json:"escrow_id,omitempty"`
	DecidedBy        *string         `json:"decided_by,omitempty"`
	DeclineReason    *string         `json:"decline_reason,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
}

type Message struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	SenderID  string    `json:"sender_id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

type BookRequest struct {
	Vertical         Vertical
	Mode             Mode
	PatientID        string
	ProviderOwnerKind OwnerKind
	ProviderOwnerID   string
	ProviderUserID    string
	SourceRef         string
	PackageID         string
	BaseHoldID        string
	Start             time.Time // zero => now
}

type RTC struct {
	Provider string `json:"provider"`
	URL      string `json:"url"`
	Room     string `json:"room"`
}

type Join struct {
	Token   string  `json:"token"`
	RTC     RTC     `json:"rtc"`
	Session Session `json:"session"`
}
```

- [ ] **Step 4: Write the pure math**

Create `backend/internal/health/consultengine/timing.go`:

```go
package consultengine

import "time"

// WarnLead is the warning lead time: five minutes, or a fifth of a shorter
// window so the warning never covers the whole session.
func WarnLead(window time.Duration) time.Duration {
	if window <= 0 {
		return 0
	}
	lead := window / 5
	if lead > WarningCap {
		lead = WarningCap
	}
	return lead
}

// WarnAt is the warning instant for a window that starts at start and ends at ends.
func WarnAt(start, ends time.Time) time.Time {
	return ends.Add(-WarnLead(ends.Sub(start)))
}

// ExtensionPriceKobo prices added minutes pro rata from the session snapshot,
// rounding up so an extension is never sold for less than its share.
func ExtensionPriceKobo(priceKobo int64, durationMinutes, addedMinutes int) int64 {
	if priceKobo <= 0 || durationMinutes <= 0 || addedMinutes <= 0 {
		return 0
	}
	d := int64(durationMinutes)
	return (priceKobo*int64(addedMinutes) + d - 1) / d
}

// JoinTTL caps a join token so it cannot outlive the session by more than a
// minute, with a one-minute floor for a last-second join.
func JoinTTL(now, endsAt time.Time, configured time.Duration) time.Duration {
	if configured <= 0 {
		configured = DefaultJoinTTL
	}
	remaining := endsAt.Sub(now)
	if remaining >= time.Minute {
		remaining += time.Minute
	} else {
		// A last-second join gets the floor itself, not the floor plus slack.
		remaining = time.Minute
	}
	if remaining > configured {
		return configured
	}
	return remaining
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/health/consultengine/ -v`
Expected: PASS for all four tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/consultengine/types.go backend/internal/health/consultengine/timing.go backend/internal/health/consultengine/timing_test.go
git commit -m "feat(consult): add session types and timer math"
```

---

### Task 4: Service core, packages, and booking

**Files:**
- Create: `backend/internal/health/consultengine/service.go`
- Create: `backend/internal/health/consultengine/packages.go`
- Create: `backend/internal/health/consultengine/sessions.go` (Book/Get only in this task)
- Test: `backend/internal/health/consultengine/engine_live_db_test.go` (created here, extended later)

**Interfaces:**
- Consumes: Task 1 schema, Task 3 types.
- Produces:
  - `NewService(db *pgxpool.Pool, media RoomMedia, esc Escrow, audit Auditor) *Service`
  - `(*Service).WithClock(func() time.Time) *Service`
  - `PublishPackage(ctx, callerID string, pkg Package) (Package, error)`
  - `ListPackages(ctx, vertical Vertical, ownerKind OwnerKind, ownerID string) ([]Package, error)`
  - `Book(ctx, req BookRequest) (Session, error)`
  - `Get(ctx, sessionID, callerID string) (Session, error)`
  - Interfaces `RoomMedia` and `Escrow` exactly as below; `Auditor` is `services.AuditService` shaped but declared locally.

- [ ] **Step 1: Write the failing live-DB test**

Create `backend/internal/health/consultengine/engine_live_db_test.go` (this file grows in later tasks; keep the helpers):

```go
package consultengine

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- fakes ----

type fakeMedia struct {
	ensured  []string
	closed   []string
	tokens   []MediaRole
	ttl      time.Duration
	ensureErr error
}

func (f *fakeMedia) EnsureRoom(_ context.Context, room string) error {
	f.ensured = append(f.ensured, room)
	return f.ensureErr
}
func (f *fakeMedia) CloseRoom(_ context.Context, room string) error {
	f.closed = append(f.closed, room)
	return nil
}
func (f *fakeMedia) JoinToken(_ context.Context, room, identity string, role MediaRole, ttl time.Duration) (string, error) {
	f.tokens = append(f.tokens, role)
	f.ttl = ttl
	return "tok-" + identity, nil
}
func (f *fakeMedia) URL() string             { return "wss://rtc.test" }
func (f *fakeMedia) TokenTTL() time.Duration { return 10 * time.Minute }

type fakeEscrow struct {
	holds    []string
	released []string
	err      error
}

func (f *fakeEscrow) HoldWithPayee(_ context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	f.holds = append(f.holds, idemKey)
	return "escrow-" + idemKey, nil
}
func (f *fakeEscrow) Release(_ context.Context, escrowID, payeeID string) error {
	f.released = append(f.released, escrowID)
	return nil
}

// ---- live DB ----

func enginePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping consult engine live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type engineFixture struct {
	pool       *pgxpool.Pool
	svc        *Service
	media      *fakeMedia
	escrow     *fakeEscrow
	clock      time.Time
	patientID  string
	providerID string
	providerRow string
}

func newEngineFixture(t *testing.T) *engineFixture {
	t.Helper()
	ctx := context.Background()
	pool := enginePool(t)
	patientID, providerID, providerRow := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{patientID, providerID} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		VALUES ($1,$2,'VET','vet','Seed Vet','APPROVED')`, providerRow, providerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.consult_sessions WHERE patient_id=$1`, patientID)
		_, _ = pool.Exec(bg, `DELETE FROM public.consult_session_packages WHERE owner_id=$1`, providerRow)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerRow)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, providerID)
	})
	f := &engineFixture{
		pool: pool, media: &fakeMedia{}, escrow: &fakeEscrow{},
		clock: time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC),
		patientID: patientID, providerID: providerID, providerRow: providerRow,
	}
	f.svc = NewService(pool, f.media, f.escrow, nil).WithClock(func() time.Time { return f.clock })
	return f
}

func (f *engineFixture) publishVetVideo(t *testing.T, minutes int, priceKobo int64) Package {
	t.Helper()
	pkg, err := f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow,
		Vertical: VerticalVet, Mode: ModeVideo,
		DurationMinutes: minutes, PriceKobo: priceKobo, Active: true,
	})
	if err != nil {
		t.Fatalf("publish package: %v", err)
	}
	return pkg
}

func TestBookSnapshotsPriceAndCreatesARoom(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)

	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo,
		PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID,
		SourceRef:      "vet_appointment:abc",
		PackageID:      pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if sess.PriceKobo != 500_000 || sess.DurationMinutes != 30 {
		t.Fatalf("snapshot = %d kobo / %d min, want 500000 / 30", sess.PriceKobo, sess.DurationMinutes)
	}
	if want := f.clock.Add(30 * time.Minute); !sess.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v", sess.EndsAt, want)
	}
	if want := f.clock.Add(25 * time.Minute); !sess.WarnAt.Equal(want) {
		t.Fatalf("warn_at = %v, want %v", sess.WarnAt, want)
	}
	if len(f.media.ensured) != 1 || f.media.ensured[0] != sess.RoomName {
		t.Fatalf("room was not provisioned: %v", f.media.ensured)
	}
	if sess.RoomName[:len("consult-vet-")] != "consult-vet-" {
		t.Fatalf("room %q is not in the consult-vet namespace", sess.RoomName)
	}

	// The price snapshot survives a later package edit.
	_, err = f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow,
		Vertical: VerticalVet, Mode: ModeVideo,
		DurationMinutes: 30, PriceKobo: 900_000, Active: true,
	})
	if err != nil {
		t.Fatalf("republish: %v", err)
	}
	again, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if again.PriceKobo != 500_000 {
		t.Fatalf("a package edit rewrote a booked price: %d", again.PriceKobo)
	}
}

func TestBookRefusesAForeignPackageAndAnUnrelatedProvider(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	other := uuid.NewString()

	_, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo,
		PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: other, SourceRef: "vet_appointment:x", PackageID: pkg.ID,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("book with an unrelated provider: err = %v, want ErrInvalid", err)
	}

	_, err = f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalPharmacy, Mode: ModeVideo,
		PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:x", PackageID: pkg.ID,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("book across verticals: err = %v, want ErrInvalid", err)
	}
}

func TestGetFoldsNonParticipantsToNotFound(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	for _, caller := range []string{uuid.NewString(), ""} {
		if _, err := f.svc.Get(context.Background(), sess.ID, caller); !errors.Is(err, ErrNotFound) {
			t.Fatalf("caller %q: err = %v, want ErrNotFound", caller, err)
		}
	}
	if _, err := f.svc.Get(context.Background(), uuid.NewString(), f.patientID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing session must fold to ErrNotFound, got %v", err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/health/consultengine/ -run TestBook -v
```
Expected: build failure — `undefined: NewService`, `undefined: Package`, etc. (With no `TEST_DATABASE_URL` exported the live tests skip; export it from your local stack when you want them to run.)

- [ ] **Step 3: Write the service core**

Create `backend/internal/health/consultengine/service.go`:

```go
package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the immutable-audit slice the engine uses. nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Escrow is the money rail the engine needs. Implemented in app by an adapter
// over *escrow.Service, so this package stays free of ledger dependencies.
type Escrow interface {
	HoldWithPayee(ctx context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (string, error)
	Release(ctx context.Context, escrowID, payeeID string) error
}

// RoomMedia provisions rooms and mints join tokens. nil means "media is off":
// every session operation that needs media fails closed with ErrMediaUnavailable.
type RoomMedia interface {
	EnsureRoom(ctx context.Context, room string) error
	CloseRoom(ctx context.Context, room string) error
	JoinToken(ctx context.Context, room, identity string, role MediaRole, ttl time.Duration) (string, error)
	URL() string
	TokenTTL() time.Duration
}

type Service struct {
	db    *pgxpool.Pool
	media RoomMedia
	esc   Escrow
	audit Auditor
	now   func() time.Time
}

func NewService(db *pgxpool.Pool, media RoomMedia, esc Escrow, audit Auditor) *Service {
	return &Service{db: db, media: media, esc: esc, audit: audit, now: time.Now}
}

// WithClock replaces the clock (tests and deterministic sweeps).
func (s *Service) WithClock(now func() time.Time) *Service {
	if now != nil {
		s.now = now
	}
	return s
}

func (s *Service) audited(actorID, targetID, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actorID, targetID, action, "health.consult", "consult_session", resourceID, oldV, newV, "", "", "info")
}

// view fills the computed fields every client reads.
func (s *Service) view(sess Session) Session {
	now := s.now()
	sess.ServerNow = now
	sess.Extendable = (sess.State == StateScheduled || sess.State == StateLive) && now.Before(sess.EndsAt)
	return sess
}

func roomName(v Vertical, sessionID string) string {
	return "consult-" + string(v) + "-" + sessionID
}

// load reads one session without authorization. Callers must scope it.
func (s *Service) load(ctx context.Context, sessionID string) (Session, error) {
	const q = `SELECT id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	                  provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	                  booked_start, ends_at, warn_at, warning_sent_at, state, room_name,
	                  base_hold_id, ended_at
	           FROM consult_sessions WHERE id=$1`
	var sess Session
	var vertical, mode, ownerKind, state string
	err := s.db.QueryRow(ctx, q, sessionID).Scan(
		&sess.ID, &vertical, &mode, &sess.PatientID, &ownerKind,
		&sess.ProviderOwnerID, &sess.ProviderUserID, &sess.SourceRef, &sess.PackageID,
		&sess.DurationMinutes, &sess.PriceKobo, &sess.BookedStart, &sess.EndsAt,
		&sess.WarnAt, &sess.WarningSentAt, &state, &sess.RoomName,
		&sess.BaseHoldID, &sess.EndedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load session: %w", err)
	}
	sess.Vertical, sess.Mode = Vertical(vertical), Mode(mode)
	sess.ProviderOwnerKind, sess.State = OwnerKind(ownerKind), State(state)
	return sess, nil
}

// loadForCaller folds "missing" and "not a participant" into the same error so
// a foreign actor cannot probe for session existence.
func (s *Service) loadForCaller(ctx context.Context, sessionID, callerID string) (Session, bool, error) {
	sess, err := s.load(ctx, sessionID)
	if err != nil {
		return Session{}, false, err
	}
	callerID = strings.TrimSpace(callerID)
	if callerID == "" {
		return Session{}, false, ErrNotFound
	}
	if callerID == sess.PatientID {
		return sess, false, nil
	}
	if callerID == sess.ProviderUserID {
		return sess, true, nil
	}
	return Session{}, false, ErrNotFound
}
```

- [ ] **Step 4: Write package publishing**

Create `backend/internal/health/consultengine/packages.go`:

```go
package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// validMode and validVertical keep the API honest even though the DB also checks.
func validMode(m Mode) bool {
	return m == ModeChat || m == ModeVoice || m == ModeVideo
}

func validVertical(v Vertical) bool {
	return v == VerticalTelemedicine || v == VerticalVet || v == VerticalPharmacy || v == VerticalLab
}

// verifyOwner proves the caller may price for this owner.
func (s *Service) verifyOwner(ctx context.Context, callerID string, kind OwnerKind, ownerID string) error {
	callerID = strings.TrimSpace(callerID)
	if callerID == "" {
		return ErrNotFound
	}
	switch kind {
	case OwnerDoctor:
		if callerID != ownerID {
			return ErrNotFound
		}
		return nil
	case OwnerHealthProvider:
		var owner string
		err := s.db.QueryRow(ctx, `SELECT owner_user_id::text FROM health_providers WHERE id=$1`, ownerID).Scan(&owner)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("consult: resolve provider owner: %w", err)
		}
		if owner != callerID {
			return ErrNotFound
		}
		return nil
	default:
		return ErrInvalid
	}
}

// PublishPackage creates or updates one price point. The caller must own the
// pricing surface; publishing for someone else is a uniform not-found.
func (s *Service) PublishPackage(ctx context.Context, callerID string, pkg Package) (Package, error) {
	if !validVertical(pkg.Vertical) || !validMode(pkg.Mode) {
		return Package{}, ErrInvalid
	}
	if pkg.DurationMinutes < MinDurationMinutes || pkg.DurationMinutes > MaxDurationMinutes {
		return Package{}, ErrInvalid
	}
	if pkg.PriceKobo < 0 || pkg.PriceKobo > 100_000_000 {
		return Package{}, ErrInvalid
	}
	if err := s.verifyOwner(ctx, callerID, pkg.OwnerKind, pkg.OwnerID); err != nil {
		return Package{}, err
	}
	const q = `INSERT INTO consult_session_packages
	             (owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active)
	           VALUES ($1,$2,$3,$4,$5,$6,$7)
	           ON CONFLICT (owner_kind, owner_id, vertical, mode, duration_minutes)
	           DO UPDATE SET price_kobo=EXCLUDED.price_kobo, active=EXCLUDED.active, updated_at=now()
	           RETURNING id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active, created_at`
	var out Package
	var ownerKind, vertical, mode string
	err := s.db.QueryRow(ctx, q, pkg.OwnerKind, pkg.OwnerID, pkg.Vertical, pkg.Mode,
		pkg.DurationMinutes, pkg.PriceKobo, pkg.Active).Scan(
		&out.ID, &ownerKind, &out.OwnerID, &vertical, &mode,
		&out.DurationMinutes, &out.PriceKobo, &out.Active, &out.CreatedAt)
	if err != nil {
		return Package{}, fmt.Errorf("consult: publish package: %w", err)
	}
	out.OwnerKind, out.Vertical, out.Mode = OwnerKind(ownerKind), Vertical(vertical), Mode(mode)
	return out, nil
}

// ListPackages returns active price points for one vertical, optionally narrowed
// to one owner.
func (s *Service) ListPackages(ctx context.Context, vertical Vertical, ownerKind OwnerKind, ownerID string) ([]Package, error) {
	if !validVertical(vertical) {
		return nil, ErrInvalid
	}
	const q = `SELECT id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active, created_at
	           FROM consult_session_packages
	           WHERE vertical=$1 AND active=true
	             AND ($2='' OR owner_kind=$2)
	             AND ($3='' OR owner_id::text=$3)
	           ORDER BY mode, duration_minutes`
	rows, err := s.db.Query(ctx, q, vertical, string(ownerKind), ownerID)
	if err != nil {
		return nil, fmt.Errorf("consult: list packages: %w", err)
	}
	defer rows.Close()
	var out []Package
	for rows.Next() {
		var p Package
		var ownerKind, vertical, mode string
		if err := rows.Scan(&p.ID, &ownerKind, &p.OwnerID, &vertical, &mode,
			&p.DurationMinutes, &p.PriceKobo, &p.Active, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.OwnerKind, p.Vertical, p.Mode = OwnerKind(ownerKind), Vertical(vertical), Mode(mode)
		out = append(out, p)
	}
	return out, rows.Err()
}
```

- [ ] **Step 5: Write Book and Get**

Create `backend/internal/health/consultengine/sessions.go`:

```go
package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// verifyProviderUser proves the user id really belongs to the pricing owner.
func (s *Service) verifyProviderUser(ctx context.Context, req BookRequest) error {
	switch req.ProviderOwnerKind {
	case OwnerDoctor:
		if req.ProviderUserID != req.ProviderOwnerID {
			return ErrInvalid
		}
		return nil
	case OwnerHealthProvider:
		var owner string
		err := s.db.QueryRow(ctx, `SELECT owner_user_id::text FROM health_providers WHERE id=$1`, req.ProviderOwnerID).Scan(&owner)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalid
		}
		if err != nil {
			return fmt.Errorf("consult: resolve provider owner: %w", err)
		}
		if owner != req.ProviderUserID {
			return ErrInvalid
		}
		return nil
	default:
		return ErrInvalid
	}
}

// Book prices a session from a published package, snapshots it, provisions the
// room and stores the row. Media is required: a patient is never sold a session
// that cannot start.
func (s *Service) Book(ctx context.Context, req BookRequest) (Session, error) {
	if !validVertical(req.Vertical) || !validMode(req.Mode) {
		return Session{}, ErrInvalid
	}
	if strings.TrimSpace(req.PatientID) == "" || strings.TrimSpace(req.SourceRef) == "" || strings.TrimSpace(req.PackageID) == "" {
		return Session{}, ErrInvalid
	}
	if err := s.verifyProviderUser(ctx, req); err != nil {
		return Session{}, err
	}
	if s.media == nil {
		return Session{}, ErrMediaUnavailable
	}

	const pq = `SELECT duration_minutes, price_kobo
	            FROM consult_session_packages
	            WHERE id=$1 AND owner_kind=$2 AND owner_id=$3 AND vertical=$4 AND mode=$5 AND active=true`
	var duration int
	var price int64
	err := s.db.QueryRow(ctx, pq, req.PackageID, req.ProviderOwnerKind, req.ProviderOwnerID, req.Vertical, req.Mode).Scan(&duration, &price)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalid
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load package: %w", err)
	}

	now := s.now()
	start := req.Start
	if start.IsZero() {
		start = now
	}
	if start.Before(now.Add(-5 * time.Minute)) {
		return Session{}, ErrInvalid
	}
	ends := start.Add(time.Duration(duration) * time.Minute)
	warn := WarnAt(start, ends)

	id := uuid.NewString()
	room := roomName(req.Vertical, id)
	if err := s.media.EnsureRoom(ctx, room); err != nil {
		return Session{}, fmt.Errorf("consult: provision room: %w", err)
	}

	const q = `INSERT INTO consult_sessions
	             (id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	              provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	              booked_start, ends_at, warn_at, state, room_name, base_hold_id)
	           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'scheduled',$15,$16)
	           RETURNING id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	                     provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	                     booked_start, ends_at, warn_at, warning_sent_at, state, room_name,
	                     base_hold_id, ended_at`
	var hold *string
	if strings.TrimSpace(req.BaseHoldID) != "" {
		hold = &req.BaseHoldID
	}
	var sess Session
	var vertical, mode, ownerKind, state string
	err = s.db.QueryRow(ctx, q, id, req.Vertical, req.Mode, req.PatientID, req.ProviderOwnerKind,
		req.ProviderOwnerID, req.ProviderUserID, req.SourceRef, req.PackageID, duration, price,
		start, ends, warn, room, hold).Scan(
		&sess.ID, &vertical, &mode, &sess.PatientID, &ownerKind,
		&sess.ProviderOwnerID, &sess.ProviderUserID, &sess.SourceRef, &sess.PackageID,
		&sess.DurationMinutes, &sess.PriceKobo, &sess.BookedStart, &sess.EndsAt,
		&sess.WarnAt, &sess.WarningSentAt, &state, &sess.RoomName,
		&sess.BaseHoldID, &sess.EndedAt)
	if err != nil {
		return Session{}, fmt.Errorf("consult: book session: %w", err)
	}
	sess.Vertical, sess.Mode, sess.ProviderOwnerKind = Vertical(vertical), Mode(mode), OwnerKind(ownerKind)
	sess.State = State(state)
	s.audited(req.PatientID, req.ProviderUserID, "health.consult.book", sess.ID, nil, map[string]any{
		"vertical": string(req.Vertical), "mode": string(req.Mode),
		"duration_minutes": duration, "price_kobo": price,
	})
	return s.view(sess), nil
}

// Get returns one session to a participant, folded to not-found otherwise.
func (s *Service) Get(ctx context.Context, sessionID, callerID string) (Session, error) {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Session{}, err
	}
	return s.view(sess), nil
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend && TEST_DATABASE_URL="<your local test DSN>" go test ./internal/health/consultengine/ -v
```
Expected: Task 3 tests PASS plus the three booking tests PASS (or SKIP with no DSN).

- [ ] **Step 7: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/consultengine/service.go backend/internal/health/consultengine/packages.go backend/internal/health/consultengine/sessions.go backend/internal/health/consultengine/engine_live_db_test.go
git commit -m "feat(consult): book priced sessions with snapshotted packages"
```

---

### Task 5: Join, completion, and the sweeper

**Files:**
- Modify: `backend/internal/health/consultengine/sessions.go` (append)
- Test: `backend/internal/health/consultengine/engine_live_db_test.go` (append)

**Interfaces:**
- Consumes: Task 4 service.
- Produces:
  - `Join(ctx, sessionID, callerID string) (Join, error)`
  - `Complete(ctx, sessionID, callerID string) error`
  - `Sweep(ctx) error`
  - `RunSweeper(ctx context.Context, interval time.Duration)`
  - internal `endSession(ctx, sess Session) error`

- [ ] **Step 1: Write the failing test**

Append to `engine_live_db_test.go`:

```go
func TestJoinMintsAPeerTokenCappedByTheRemainingWindow(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	patientJoin, err := f.svc.Join(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("patient join: %v", err)
	}
	if patientJoin.Token != "tok-"+f.patientID || patientJoin.RTC.Provider != "livekit" || patientJoin.RTC.URL != "wss://rtc.test" {
		t.Fatalf("bad join payload: %+v", patientJoin)
	}
	if patientJoin.Session.State != StateLive {
		t.Fatalf("first join must move the session live, got %q", patientJoin.Session.State)
	}
	if got := f.media.tokens[len(f.media.tokens)-1]; got != MediaPeer {
		t.Fatalf("patient role = %q, want %q", got, MediaPeer)
	}
	if f.media.ttl != 10*time.Minute {
		t.Fatalf("ttl = %v, want the 10m client default", f.media.ttl)
	}

	if _, err := f.svc.Join(context.Background(), sess.ID, f.providerID); err != nil {
		t.Fatalf("provider join: %v", err)
	}
	if got := f.media.tokens[len(f.media.tokens)-1]; got != MediaPeerAdmin {
		t.Fatalf("provider role = %q, want %q", got, MediaPeerAdmin)
	}

	// Late in the session the token shrinks to the remaining time + 1m.
	f.clock = sess.EndsAt.Add(-90 * time.Second)
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); err != nil {
		t.Fatalf("late join: %v", err)
	}
	if f.media.ttl != 150*time.Second {
		t.Fatalf("late ttl = %v, want 150s", f.media.ttl)
	}
}

func TestSweepWarnsThenEndsAndIsIdempotent(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	_, _ = f.svc.Join(context.Background(), sess.ID, f.patientID)

	f.clock = sess.WarnAt.Add(time.Second)
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep at warning: %v", err)
	}
	warned, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if warned.WarningSentAt == nil {
		t.Fatal("the warning was not recorded")
	}

	f.clock = sess.EndsAt.Add(time.Second)
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep at end: %v", err)
	}
	ended, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if ended.State != StateEnded || ended.EndedAt == nil {
		t.Fatalf("state = %q ended_at = %v, want ended", ended.State, ended.EndedAt)
	}
	if len(f.media.closed) != 1 || f.media.closed[0] != sess.RoomName {
		t.Fatalf("room close calls = %v, want [%s]", f.media.closed, sess.RoomName)
	}
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if len(f.media.closed) != 1 {
		t.Fatalf("sweep closed the room twice: %v", f.media.closed)
	}
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); !errors.Is(err, ErrState) {
		t.Fatalf("join after end: err = %v, want ErrState", err)
	}
}

func TestCompleteIsIdempotentAndParticipantOnly(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if err := f.svc.Complete(context.Background(), sess.ID, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger complete: err = %v, want ErrNotFound", err)
	}
	for i := 0; i < 2; i++ {
		if err := f.svc.Complete(context.Background(), sess.ID, f.providerID); err != nil {
			t.Fatalf("complete #%d: %v", i+1, err)
		}
	}
	if len(f.media.closed) != 1 {
		t.Fatalf("close calls = %v, want exactly one", f.media.closed)
	}
}

func TestCompleteDoesNotRewriteATerminalState(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(),
		`UPDATE consult_sessions SET state='cancelled' WHERE id=$1`, sess.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if err := f.svc.Complete(context.Background(), sess.ID, f.providerID); err != nil {
		t.Fatalf("complete cancelled: %v", err)
	}
	got, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.State != StateCancelled {
		t.Fatalf("state = %q, want cancelled (Complete must not rewrite a terminal state)", got.State)
	}
	if len(f.media.closed) != 0 {
		t.Fatalf("Complete closed the room of a cancelled session: %v", f.media.closed)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/health/consultengine/ -run 'TestJoin|TestSweep|TestComplete' -v`
Expected: compile error `undefined: Join` / `Sweep` / `Complete`.

- [ ] **Step 3: Implement Join, Complete, Sweep**

Append to `backend/internal/health/consultengine/sessions.go`:

```go
// Join mints a room token for one participant and returns the server clock so
// the client can render the countdown without trusting the device clock.
func (s *Service) Join(ctx context.Context, sessionID, callerID string) (Join, error) {
	sess, isProvider, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Join{}, err
	}
	now := s.now()
	if sess.State == StateEnded || sess.State == StateCancelled || !now.Before(sess.EndsAt) {
		return Join{}, ErrState
	}
	if s.media == nil {
		return Join{}, ErrMediaUnavailable
	}
	if sess.State == StateScheduled {
		tag, err := s.db.Exec(ctx, `UPDATE consult_sessions SET state='live', updated_at=$2
		                              WHERE id=$1 AND state='scheduled'`, sess.ID, now)
		if err != nil {
			return Join{}, fmt.Errorf("consult: mark live: %w", err)
		}
		if tag.RowsAffected() == 0 {
			// A concurrent join may have moved it live, or a sweeper ended it.
			cur, err := s.load(ctx, sess.ID)
			if err != nil {
				return Join{}, err
			}
			if cur.State != StateLive || !now.Before(cur.EndsAt) {
				return Join{}, ErrState
			}
			sess = cur
		} else {
			sess.State = StateLive
		}
	}
	if err := s.media.EnsureRoom(ctx, sess.RoomName); err != nil {
		return Join{}, fmt.Errorf("consult: ensure room: %w", err)
	}
	role := MediaPeer
	if isProvider {
		role = MediaPeerAdmin
	}
	ttl := JoinTTL(now, sess.EndsAt, s.media.TokenTTL())
	token, err := s.media.JoinToken(ctx, sess.RoomName, callerID, role, ttl)
	if err != nil {
		return Join{}, fmt.Errorf("consult: join token: %w", err)
	}
	return Join{
		Token: token,
		RTC:   RTC{Provider: "livekit", URL: s.media.URL(), Room: sess.RoomName},
		Session: s.view(sess),
	}, nil
}

// endSession marks a session ended, cuts the room and releases extension money.
// It is idempotent: a second call on an ended session does nothing.
func (s *Service) endSession(ctx context.Context, sess Session) error {
	if sess.State == StateEnded {
		return nil
	}
	now := s.now()
	tag, err := s.db.Exec(ctx, `UPDATE consult_sessions SET state='ended', ended_at=$2, updated_at=$2
	                            WHERE id=$1 AND state IN ('scheduled','live')`, sess.ID, now)
	if err != nil {
		return fmt.Errorf("consult: mark ended: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	if s.media != nil {
		if err := s.media.CloseRoom(ctx, sess.RoomName); err != nil {
			// The token TTL and LiveKit's empty-room timeout finish the cut; the
			// state is already authoritative.
			fmt.Printf("[consult] close room %s: %v\n", sess.RoomName, err)
		}
	}
	return s.releaseExtensions(ctx, sess)
}

// Complete ends a session on a participant's request.
func (s *Service) Complete(ctx context.Context, sessionID, callerID string) error {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return err
	}
	return s.endSession(ctx, sess)
}

// Sweep records warnings and ends due sessions. It is the timer backstop when
// both clients vanish.
func (s *Service) Sweep(ctx context.Context) error {
	now := s.now()
	if _, err := s.db.Exec(ctx, `UPDATE consult_sessions SET warning_sent_at=$1, updated_at=$1
	                              WHERE state IN ('scheduled','live')
	                                AND warning_sent_at IS NULL
	                                AND warn_at <= $1 AND ends_at > $1`, now); err != nil {
		return fmt.Errorf("consult: sweep warnings: %w", err)
	}

	rows, err := s.db.Query(ctx, `SELECT id, vertical, mode, patient_id, provider_owner_kind,
	                                     provider_owner_id, provider_user_id, source_ref, package_id,
	                                     duration_minutes, price_kobo, booked_start, ends_at, warn_at,
	                                     warning_sent_at, state, room_name, base_hold_id, ended_at
	                              FROM consult_sessions
	                              WHERE state IN ('scheduled','live') AND ends_at <= $1`, now)
	if err != nil {
		return fmt.Errorf("consult: sweep due sessions: %w", err)
	}
	var due []Session
	for rows.Next() {
		var sess Session
		var vertical, mode, ownerKind, state string
		if err := rows.Scan(&sess.ID, &vertical, &mode, &sess.PatientID,
			&ownerKind, &sess.ProviderOwnerID, &sess.ProviderUserID,
			&sess.SourceRef, &sess.PackageID, &sess.DurationMinutes, &sess.PriceKobo,
			&sess.BookedStart, &sess.EndsAt, &sess.WarnAt, &sess.WarningSentAt,
			&state, &sess.RoomName, &sess.BaseHoldID, &sess.EndedAt); err != nil {
			rows.Close()
			return err
		}
		sess.Vertical, sess.Mode = Vertical(vertical), Mode(mode)
		sess.ProviderOwnerKind, sess.State = OwnerKind(ownerKind), State(state)
		due = append(due, sess)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, sess := range due {
		if err := s.endSession(ctx, sess); err != nil {
			return err
		}
	}

	// A release that failed after the session ended is retried here: the session
	// is no longer in the due set, so endSession will not run again for it.
	rows, err = s.db.Query(ctx, `SELECT DISTINCT e.session_id
	                             FROM consult_extension_requests e
	                             JOIN consult_sessions s ON s.id=e.session_id
	                             WHERE s.state='ended' AND e.status='paid'
	                               AND e.escrow_id IS NOT NULL AND e.released_at IS NULL`)
	if err != nil {
		return fmt.Errorf("consult: list unreleased escrows: %w", err)
	}
	var retry []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		retry = append(retry, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range retry {
		sess, err := s.load(ctx, id)
		if err != nil {
			return err
		}
		if err := s.releaseExtensions(ctx, sess); err != nil {
			return err
		}
	}

	if _, err := s.db.Exec(ctx, `UPDATE consult_extension_requests e
	                              SET status='expired', updated_at=$1
	                              FROM consult_sessions s
	                              WHERE e.session_id=s.id
	                                AND e.status IN ('pending_approval','approved_awaiting_payment')
	                                AND (s.state='ended' OR s.ends_at <= $1
	                                     OR (e.payment_expires_at IS NOT NULL AND e.payment_expires_at <= $1))`, now); err != nil {
		return fmt.Errorf("consult: expire extensions: %w", err)
	}
	return nil
}

// RunSweeper runs Sweep on an interval until ctx is cancelled.
func (s *Service) RunSweeper(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweepCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			if err := s.Sweep(sweepCtx); err != nil {
				fmt.Printf("[consult] sweep: %v\n", err)
			}
			cancel()
		}
	}
}
```

`releaseExtensions` is defined in Task 6; to keep this task compilable, add a temporary no-op now and replace it next task:

```go
func (s *Service) releaseExtensions(context.Context, Session) error { return nil }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && TEST_DATABASE_URL="<your local test DSN>" go test ./internal/health/consultengine/ -v`
Expected: PASS (or SKIP).

- [ ] **Step 5: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/consultengine/sessions.go backend/internal/health/consultengine/engine_live_db_test.go
git commit -m "feat(consult): join tokens, completion and the timer sweeper"
```

---

### Task 6: Extensions — approve first, then pay

**Files:**
- Create: `backend/internal/health/consultengine/extensions.go`
- Modify: `backend/internal/health/consultengine/sessions.go` (replace the temporary `releaseExtensions`)
- Test: `backend/internal/health/consultengine/engine_live_db_test.go` (append)

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces:
  - `RequestExtension(ctx, sessionID, callerID string, minutes int) (Extension, error)`
  - `DecideExtension(ctx, sessionID, extID, callerID string, approve bool, reason string) (Extension, error)`
  - `PayExtension(ctx, sessionID, extID, callerID string) (Extension, Session, error)`
  - `releaseExtensions(ctx, sess Session) error`

- [ ] **Step 1: Write the failing tests**

Append to `engine_live_db_test.go`:

```go
func TestPatientExtensionNeedsApprovalThenPaymentBeforeItApplies(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	_, _ = f.svc.Join(context.Background(), sess.ID, f.patientID)

	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if ext.Status != ExtPending || ext.PriceKobo != 166_667 {
		t.Fatalf("request = %+v, want pending at 166667 kobo", ext)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatal("a request must not move money")
	}
	unchanged, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if !unchanged.EndsAt.Equal(sess.EndsAt) {
		t.Fatal("a pending request changed ends_at")
	}

	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.patientID, true, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("patient approving their own request: err = %v, want ErrNotFound", err)
	}
	approved, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, "")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if approved.Status != ExtAwaitingPayment || approved.PaymentExpiresAt == nil {
		t.Fatalf("approval = %+v, want awaiting payment with a deadline", approved)
	}
	still, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if !still.EndsAt.Equal(sess.EndsAt) {
		t.Fatal("approval alone changed ends_at")
	}

	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.providerID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("provider paying: err = %v, want ErrNotFound", err)
	}
	paid, extended, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	if paid.Status != ExtPaid || paid.EscrowID == nil {
		t.Fatalf("paid = %+v, want paid with escrow", paid)
	}
	if welcome := "consult-ext:" + ext.ID; f.escrow.holds[0] != welcome {
		t.Fatalf("idempotency key = %q, want %q", f.escrow.holds[0], welcome)
	}
	if want := sess.EndsAt.Add(10 * time.Minute); !extended.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v", extended.EndsAt, want)
	}
	if !extended.WarnAt.Before(extended.EndsAt) {
		t.Fatal("warn_at was not recomputed")
	}
	if extended.WarningSentAt != nil {
		t.Fatal("the warning flag must reset so the new end is announced")
	}

	// Paying twice is idempotent: the escrow key is the extension id.
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); !errors.Is(err, ErrExtensionNotPayable) {
		t.Fatalf("second pay: err = %v, want ErrExtensionNotPayable", err)
	}
	if len(f.escrow.holds) != 1 {
		t.Fatalf("holds = %v, want one", f.escrow.holds)
	}
}

func TestExtensionApprovalExpiresAfterFiveMinutes(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	ext, _ := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 5)
	if _, err := f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	f.clock = f.clock.Add(ExtensionPaymentWindow + time.Second)
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); !errors.Is(err, ErrPaymentExpired) && !errors.Is(err, ErrExtensionNotPayable) {
		t.Fatalf("late pay: err = %v, want ErrPaymentExpired", err)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatalf("late payment moved money: %v", f.escrow.holds)
	}
}

func TestProviderExtensionAppliesImmediatelyAndFree(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	ext, err := f.svc.RequestExtension(context.Background(), sess.ID, f.providerID, 15)
	if err != nil {
		t.Fatalf("provider extend: %v", err)
	}
	if ext.Status != ExtPaid || ext.PriceKobo != 0 || ext.EscrowID != nil {
		t.Fatalf("provider extension = %+v, want paid/free/no escrow", ext)
	}
	after, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if want := sess.EndsAt.Add(15 * time.Minute); !after.EndsAt.Equal(want) {
		t.Fatalf("ends_at = %v, want %v", after.EndsAt, want)
	}
	if len(f.escrow.holds) != 0 {
		t.Fatal("a provider extension charged the patient")
	}
}

func TestExtensionCannotPushPastFourHoursAndEndReleasesEscrow(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if _, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 240); !errors.Is(err, ErrInvalid) {
		t.Fatalf("4h extension: err = %v, want ErrInvalid", err)
	}
	if _, err := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("zero extension: err = %v, want ErrInvalid", err)
	}

	ext, _ := f.svc.RequestExtension(context.Background(), sess.ID, f.patientID, 10)
	_, _ = f.svc.DecideExtension(context.Background(), sess.ID, ext.ID, f.providerID, true, "")
	if _, _, err := f.svc.PayExtension(context.Background(), sess.ID, ext.ID, f.patientID); err != nil {
		t.Fatalf("pay: %v", err)
	}
	extended, _ := f.svc.Get(context.Background(), sess.ID, f.patientID)
	f.clock = extended.EndsAt.Add(time.Second)
	if err := f.svc.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(f.escrow.released) != 1 || f.escrow.released[0] != "escrow-consult-ext:"+ext.ID {
		t.Fatalf("released = %v, want the one extension escrow", f.escrow.released)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/health/consultengine/ -run 'TestPatientExtension|TestExtension|TestProviderExtension' -v`
Expected: compile error `undefined: RequestExtension`.

- [ ] **Step 3: Implement extensions**

Create `backend/internal/health/consultengine/extensions.go`:

```go
package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const extColumns = `id, session_id, requested_by, added_minutes, price_kobo, status,
                    approved_at, payment_expires_at, paid_at, escrow_id, decided_by,
                    decline_reason, created_at`

func scanExtension(row pgx.Row) (Extension, error) {
	var e Extension
	var status string
	err := row.Scan(&e.ID, &e.SessionID, &e.RequestedBy, &e.AddedMinutes, &e.PriceKobo,
		&status, &e.ApprovedAt, &e.PaymentExpiresAt, &e.PaidAt, &e.EscrowID,
		&e.DecidedBy, &e.DeclineReason, &e.CreatedAt)
	e.Status = ExtensionStatus(status)
	return e, err
}

func (s *Service) loadExtension(ctx context.Context, sessionID, extID string) (Extension, error) {
	q := `SELECT ` + extColumns + ` FROM consult_extension_requests WHERE id=$1 AND session_id=$2`
	ext, err := scanExtension(s.db.QueryRow(ctx, q, extID, sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Extension{}, ErrNotFound
	}
	if err != nil {
		return Extension{}, fmt.Errorf("consult: load extension: %w", err)
	}
	return ext, nil
}

// RequestExtension records an extension request. A provider's request is a free
// grant applied at once; a patient's waits for provider approval.
func (s *Service) RequestExtension(ctx context.Context, sessionID, callerID string, minutes int) (Extension, error) {
	sess, isProvider, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Extension{}, err
	}
	now := s.now()
	if sess.State == StateEnded || sess.State == StateCancelled || !now.Before(sess.EndsAt) {
		return Extension{}, ErrState
	}
	if minutes < 1 || minutes > MaxExtensionMinutes {
		return Extension{}, ErrInvalid
	}
	if sess.EndsAt.Add(time.Duration(minutes) * time.Minute).After(sess.BookedStart.Add(MaxSessionWindow)) {
		return Extension{}, ErrInvalid
	}
	price := ExtensionPriceKobo(sess.PriceKobo, sess.DurationMinutes, minutes)
	status := ExtPending
	if isProvider {
		status, price = ExtPaid, 0
	}

	const q = `INSERT INTO consult_extension_requests
	             (session_id, requested_by, added_minutes, price_kobo, status,
	              approved_at, paid_at)
	           VALUES ($1,$2,$3,$4,$5,$6,$7)
	           RETURNING ` + extColumns
	var approved, paid *time.Time
	if isProvider {
		approved, paid = &now, &now
	}
	ext, err := scanExtension(s.db.QueryRow(ctx, q, sessionID, callerID, minutes, price, status, approved, paid))
	if err != nil {
		return Extension{}, fmt.Errorf("consult: request extension: %w", err)
	}
	if isProvider {
		if _, err := s.applyExtension(ctx, sess, minutes); err != nil {
			return Extension{}, err
		}
	}
	s.audited(callerID, sess.PatientID, "health.consult.extension.request", ext.ID, nil,
		map[string]any{"added_minutes": minutes, "price_kobo": price, "status": string(status)})
	return ext, nil
}

// DecideExtension is the provider's approval or decline of a patient request.
func (s *Service) DecideExtension(ctx context.Context, sessionID, extID, callerID string, approve bool, reason string) (Extension, error) {
	sess, isProvider, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Extension{}, err
	}
	if !isProvider {
		return Extension{}, ErrNotFound
	}
	ext, err := s.loadExtension(ctx, sessionID, extID)
	if err != nil {
		return Extension{}, err
	}
	if ext.Status != ExtPending {
		return Extension{}, ErrExtensionNotPayable
	}
	now := s.now()
	if now.Before(sess.EndsAt) == false {
		return Extension{}, ErrState
	}
	var updated Extension
	if approve {
		expires := now.Add(ExtensionPaymentWindow)
		q := `UPDATE consult_extension_requests
		      SET status='approved_awaiting_payment', approved_at=$2, payment_expires_at=$3,
		          decided_by=$4, updated_at=$2
		      WHERE id=$1 AND status='pending_approval'
		      RETURNING ` + extColumns
		updated, err = scanExtension(s.db.QueryRow(ctx, q, extID, now, expires, callerID))
	} else {
		reason = strings.TrimSpace(reason)
		var why *string
		if reason != "" {
			why = &reason
		}
		q := `UPDATE consult_extension_requests
		      SET status='declined', decided_by=$2, decline_reason=$3, updated_at=$4
		      WHERE id=$1 AND status='pending_approval'
		      RETURNING ` + extColumns
		updated, err = scanExtension(s.db.QueryRow(ctx, q, extID, callerID, why, now))
	}
	if err != nil {
		return Extension{}, fmt.Errorf("consult: decide extension: %w", err)
	}
	s.audited(callerID, sess.PatientID, "health.consult.extension.decide", extID, nil,
		map[string]any{"approved": approve})
	return updated, nil
}

// PayExtension moves the patient's approved extension into escrow and applies
// the added minutes. The escrow key is the extension id, so a retry cannot
// charge twice.
func (s *Service) PayExtension(ctx context.Context, sessionID, extID, callerID string) (Extension, Session, error) {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Extension{}, Session{}, err
	}
	if callerID != sess.PatientID {
		return Extension{}, Session{}, ErrNotFound
	}
	ext, err := s.loadExtension(ctx, sessionID, extID)
	if err != nil {
		return Extension{}, Session{}, err
	}
	if ext.Status != ExtAwaitingPayment {
		return Extension{}, Session{}, ErrExtensionNotPayable
	}
	now := s.now()
	if ext.PaymentExpiresAt == nil || !now.Before(*ext.PaymentExpiresAt) || !now.Before(sess.EndsAt) {
		_, _ = s.db.Exec(ctx, `UPDATE consult_extension_requests SET status='expired', updated_at=$2
		                       WHERE id=$1 AND status='approved_awaiting_payment'`, extID, now)
		return Extension{}, Session{}, ErrPaymentExpired
	}
	if s.esc == nil {
		return Extension{}, Session{}, ErrEscrowUnavailable
	}
	escrowID, err := s.esc.HoldWithPayee(ctx, sess.PatientID, sess.ProviderUserID,
		sess.SourceRef, "consult_extension", "consult-ext:"+ext.ID, ext.PriceKobo)
	if err != nil {
		return Extension{}, Session{}, fmt.Errorf("consult: hold extension payment: %w", err)
	}
	q := `UPDATE consult_extension_requests
	      SET status='paid', paid_at=$2, escrow_id=$3, updated_at=$2
	      WHERE id=$1 AND status='approved_awaiting_payment'
	      RETURNING ` + extColumns
	paid, err := scanExtension(s.db.QueryRow(ctx, q, extID, now, escrowID))
	if err != nil {
		return Extension{}, Session{}, fmt.Errorf("consult: mark extension paid: %w", err)
	}
	updated, err := s.applyExtension(ctx, sess, ext.AddedMinutes)
	if err != nil {
		return Extension{}, Session{}, err
	}
	s.audited(callerID, sess.ProviderUserID, "health.consult.extension.pay", extID, nil,
		map[string]any{"price_kobo": ext.PriceKobo, "escrow_id": escrowID})
	return paid, s.view(updated), nil
}

// applyExtension moves ends_at forward from whichever is later (now, current
// end) and resets the warning so the new end is announced.
func (s *Service) applyExtension(ctx context.Context, sess Session, minutes int) (Session, error) {
	now := s.now()
	base := sess.EndsAt
	if now.After(base) {
		base = now
	}
	ends := base.Add(time.Duration(minutes) * time.Minute)
	warn := WarnAt(sess.BookedStart, ends)
	const q = `UPDATE consult_sessions
	           SET ends_at=$2, warn_at=$3, warning_sent_at=NULL, updated_at=$4
	           WHERE id=$1 AND state IN ('scheduled','live')
	           RETURNING ends_at, warn_at`
	var gotEnd, gotWarn time.Time
	if err := s.db.QueryRow(ctx, q, sess.ID, ends, warn, now).Scan(&gotEnd, &gotWarn); err != nil {
		return Session{}, fmt.Errorf("consult: apply extension: %w", err)
	}
	updated, err := s.load(ctx, sess.ID)
	if err != nil {
		return Session{}, err
	}
	return updated, nil
}

// releaseExtensions releases every paid extension hold for an ended session,
// once. A release failure is retried by the next sweep because released_at
// stays NULL.
func (s *Service) releaseExtensions(ctx context.Context, sess Session) error {
	if s.esc == nil {
		return nil
	}
	rows, err := s.db.Query(ctx, `SELECT id, escrow_id FROM consult_extension_requests
	                              WHERE session_id=$1 AND status='paid'
	                                AND escrow_id IS NOT NULL AND released_at IS NULL`, sess.ID)
	if err != nil {
		return fmt.Errorf("consult: list extension escrows: %w", err)
	}
	type pending struct{ id, escrow string }
	var items []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.escrow); err != nil {
			rows.Close()
			return err
		}
		items = append(items, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, p := range items {
		if err := s.esc.Release(ctx, p.escrow, sess.ProviderUserID); err != nil {
			return fmt.Errorf("consult: release extension escrow: %w", err)
		}
		if _, err := s.db.Exec(ctx, `UPDATE consult_extension_requests SET released_at=$2 WHERE id=$1`, p.id, s.now()); err != nil {
			return fmt.Errorf("consult: mark extension released: %w", err)
		}
	}
	return nil
}
```

Delete the temporary `releaseExtensions` no-op from `sessions.go` (Task 5, Step 3) so the real implementation is the only definition.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && TEST_DATABASE_URL="<your local test DSN>" go test ./internal/health/consultengine/ -v`
Expected: all extension tests PASS. Note the first extension test asserts `166_667` — that is `ceil(500000*10/30)`.

- [ ] **Step 5: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/consultengine/extensions.go backend/internal/health/consultengine/sessions.go backend/internal/health/consultengine/engine_live_db_test.go
git commit -m "feat(consult): approve-then-pay extensions with escrow"
```

---

### Task 7: Session chat and participant scoping

**Files:**
- Create: `backend/internal/health/consultengine/messages.go`
- Test: `backend/internal/health/consultengine/engine_live_db_test.go` (append)

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces:
  - `PostMessage(ctx, sessionID, callerID, body string) (Message, error)`
  - `ListMessages(ctx, sessionID, callerID string, after time.Time) ([]Message, error)`

- [ ] **Step 1: Write the failing test**

Append to `engine_live_db_test.go`:

```go
func TestSessionChatIsParticipantScopedAndClosesAtZero(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet_appointment:abc", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "  hello doc  "); err != nil {
		t.Fatalf("post: %v", err)
	}
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.providerID, "hello patient"); err != nil {
		t.Fatalf("provider post: %v", err)
	}
	msgs, err := f.svc.ListMessages(context.Background(), sess.ID, f.providerID, time.Time{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(msgs) != 2 || msgs[0].Body != "hello doc" {
		t.Fatalf("messages = %+v, want two in order with trimmed body", msgs)
	}
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, uuid.NewString(), "hi"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger post: err = %v, want ErrNotFound", err)
	}
	if _, err := f.svc.ListMessages(context.Background(), sess.ID, uuid.NewString(), time.Time{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger list: err = %v, want ErrNotFound", err)
	}
	if _, err := f.svc.ListMessages(context.Background(), uuid.NewString(), f.patientID, time.Time{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing session list: err = %v, want ErrNotFound", err)
	}

	f.clock = sess.EndsAt.Add(-time.Second)
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "still here"); err != nil {
		t.Fatalf("post before end: %v", err)
	}
	f.clock = sess.EndsAt
	if _, err := f.svc.PostMessage(context.Background(), sess.ID, f.patientID, "too late"); !errors.Is(err, ErrState) {
		t.Fatalf("post at end: err = %v, want ErrState", err)
	}
	// Reading stays open after the end.
	if _, err := f.svc.ListMessages(context.Background(), sess.ID, f.patientID, time.Time{}); err != nil {
		t.Fatalf("read after end: %v", err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/health/consultengine/ -run TestSessionChat -v`
Expected: compile error `undefined: PostMessage`.

- [ ] **Step 3: Implement chat**

Create `backend/internal/health/consultengine/messages.go`:

```go
package consultengine

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const maxMessageLen = 4000

// PostMessage appends one message to a session's thread. Posting closes at
// ends_at; the thread stays readable to participants afterwards.
func (s *Service) PostMessage(ctx context.Context, sessionID, callerID, body string) (Message, error) {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Message{}, err
	}
	now := s.now()
	if sess.State == StateEnded || sess.State == StateCancelled || !now.Before(sess.EndsAt) {
		return Message{}, ErrState
	}
	body = strings.TrimSpace(body)
	if body == "" || len(body) > maxMessageLen {
		return Message{}, ErrInvalid
	}
	const q = `INSERT INTO consult_session_messages (session_id, sender_id, body)
	           VALUES ($1,$2,$3) RETURNING id, session_id, sender_id, body, created_at`
	var m Message
	if err := s.db.QueryRow(ctx, q, sessionID, callerID, body).Scan(
		&m.ID, &m.SessionID, &m.SenderID, &m.Body, &m.CreatedAt); err != nil {
		return Message{}, fmt.Errorf("consult: post message: %w", err)
	}
	return m, nil
}

// ListMessages returns the thread in order, optionally after one timestamp.
func (s *Service) ListMessages(ctx context.Context, sessionID, callerID string, after time.Time) ([]Message, error) {
	if _, _, err := s.loadForCaller(ctx, sessionID, callerID); err != nil {
		return nil, err
	}
	const q = `SELECT id, session_id, sender_id, body, created_at
	           FROM consult_session_messages
	           WHERE session_id=$1 AND created_at > $2
	           ORDER BY created_at ASC, id ASC`
	rows, err := s.db.Query(ctx, q, sessionID, after)
	if err != nil {
		return nil, fmt.Errorf("consult: list messages: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SessionID, &m.SenderID, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && TEST_DATABASE_URL="<your local test DSN>" go test ./internal/health/consultengine/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/consultengine/messages.go backend/internal/health/consultengine/engine_live_db_test.go
git commit -m "feat(consult): window-gated session chat"
```

---

### Task 8: The consult LiveKit rail

**Files:**
- Create: `backend/internal/app/consult_livekit.go`
- Test: `backend/internal/app/consult_livekit_test.go`

**Interfaces:**
- Consumes: `liveKitAPI` and `*livekit.Client` from `academy_livekit.go`; `consultengine.RoomMedia`, `MediaRole`, `ErrMediaUnavailable`.
- Produces:
  - `const consultRoomPrefix = "consult-"`
  - `consultLiveKitRail{lk liveKitAPI, defaultTTL time.Duration}` implementing `consultengine.RoomMedia`
  - `consultMediaFor(cfg config.Config, lk *livekit.Client) consultengine.RoomMedia` (nil when the flag is off; refusing implementation when the client is nil)

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/app/consult_livekit_test.go`:

```go
package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/integrations/livekit"
)

func TestConsultRailRefusesRoomsOutsideItsNamespace(t *testing.T) {
	f := &fakeLK{}
	rail := consultLiveKitRail{lk: f, defaultTTL: 10 * time.Minute}
	for _, room := range []string{"academy-live-s1", "consult-s1", "consult-vet", ""} {
		if err := rail.EnsureRoom(context.Background(), room); err == nil {
			t.Fatalf("EnsureRoom(%q) must refuse", room)
		}
		if _, err := rail.JoinToken(context.Background(), room, "u1", consultengine.MediaPeer, time.Minute); err == nil {
			t.Fatalf("JoinToken(%q) must refuse", room)
		}
	}
	if len(f.created) != 0 || len(f.tokens) != 0 {
		t.Fatalf("a refused room reached LiveKit: created=%v tokens=%v", f.created, f.tokens)
	}
}

func TestConsultRailMapsPeerRolesAndPassesTheTTL(t *testing.T) {
	f := &fakeLK{}
	rail := consultLiveKitRail{lk: f, defaultTTL: 10 * time.Minute}
	room := "consult-vet-abc"
	if err := rail.EnsureRoom(context.Background(), room); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if len(f.created) != 1 || f.created[0] != room {
		t.Fatalf("created = %v, want [%s]", f.created, room)
	}
	if _, err := rail.JoinToken(context.Background(), room, "p1", consultengine.MediaPeer, 90*time.Second); err != nil {
		t.Fatalf("patient token: %v", err)
	}
	if _, err := rail.JoinToken(context.Background(), room, "d1", consultengine.MediaPeerAdmin, 90*time.Second); err != nil {
		t.Fatalf("provider token: %v", err)
	}
	if len(f.tokens) != 2 {
		t.Fatalf("tokens = %v", f.tokens)
	}
	if f.tokens[0].Role != livekit.RolePeer || f.tokens[1].Role != livekit.RolePeerAdmin {
		t.Fatalf("roles = %q, %q; want peer, peer_admin", f.tokens[0].Role, f.tokens[1].Role)
	}
	if f.tokens[0].TTL != 90*time.Second {
		t.Fatalf("ttl = %v, want 90s", f.tokens[0].TTL)
	}
	if rail.URL() != "wss://rtc.example.com" {
		t.Fatalf("url = %q", rail.URL())
	}
	if rail.TokenTTL() != 10*time.Minute {
		t.Fatalf("token ttl = %v", rail.TokenTTL())
	}
}

func TestConsultMediaFailsClosed(t *testing.T) {
	off := config.Config{}
	if m := consultMediaFor(off, nil); m != nil {
		t.Fatal("media must be nil when the LiveKit flag is off")
	}
	on := config.Config{FeatureLiveKitEnabled: true, LiveKitTokenTTLSeconds: 600}
	m := consultMediaFor(on, nil)
	if m == nil {
		t.Fatal("flag on with a broken client must still return a refusing implementation")
	}
	if err := m.EnsureRoom(context.Background(), "consult-vet-x"); !errors.Is(err, consultengine.ErrMediaUnavailable) {
		t.Fatalf("EnsureRoom: err = %v, want ErrMediaUnavailable", err)
	}
	if _, err := m.JoinToken(context.Background(), "consult-vet-x", "u", consultengine.MediaPeer, time.Minute); !errors.Is(err, consultengine.ErrMediaUnavailable) {
		t.Fatalf("JoinToken: err = %v, want ErrMediaUnavailable", err)
	}
	if m.URL() != "" {
		t.Fatalf("a refusing rail must not advertise a URL, got %q", m.URL())
	}
}
```

The `fakeLK` type already exists in `academy_livekit_test.go` in the same package; reuse it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/app/ -run TestConsult -v`
Expected: compile error `undefined: consultLiveKitRail`.

- [ ] **Step 3: Implement the rail**

Create `backend/internal/app/consult_livekit.go`:

```go
package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/integrations/livekit"
)

// consultRoomPrefix names every room the shared consult engine owns. The rail
// refuses to provision or mint for anything outside it, so consult code cannot
// reach academy rooms or arbitrary SFU rooms.
const consultRoomPrefix = "consult-"

type consultLiveKitRail struct {
	lk         liveKitAPI
	defaultTTL time.Duration
}

var _ consultengine.RoomMedia = consultLiveKitRail{}

// consultRoomOK reports whether room is a complete consult room name of the
// form consult-<vertical>-<session id>. The bare prefix, a name with no session
// id (for example "consult-vet"), and anything outside the namespace are
// refused, so a partial name cannot provision or mint against a shared room.
func consultRoomOK(room string) bool {
	rest, ok := strings.CutPrefix(room, consultRoomPrefix)
	if !ok {
		return false
	}
	vertical, session, found := strings.Cut(rest, "-")
	return found && vertical != "" && session != ""
}

func (c consultLiveKitRail) EnsureRoom(ctx context.Context, room string) error {
	if !consultRoomOK(room) {
		return errors.New("consult live: not a consult room")
	}
	if err := c.lk.CreateRoom(ctx, room); err != nil {
		return fmt.Errorf("consult live: provision room: %w", err)
	}
	return nil
}

func (c consultLiveKitRail) CloseRoom(ctx context.Context, room string) error {
	if !consultRoomOK(room) {
		return errors.New("consult live: not a consult room")
	}
	return c.lk.DeleteRoom(ctx, room)
}

func (c consultLiveKitRail) JoinToken(ctx context.Context, room, identity string, role consultengine.MediaRole, ttl time.Duration) (string, error) {
	if !consultRoomOK(room) {
		return "", errors.New("consult live: not a consult room")
	}
	var r livekit.Role
	switch role {
	case consultengine.MediaPeer:
		r = livekit.RolePeer
	case consultengine.MediaPeerAdmin:
		r = livekit.RolePeerAdmin
	default:
		return "", fmt.Errorf("consult live: unknown role %q", role)
	}
	tok, err := c.lk.JoinToken(livekit.JoinRequest{Room: room, Identity: identity, Role: r, TTL: ttl})
	if err != nil {
		return "", fmt.Errorf("consult live: join token: %w", err)
	}
	return tok.JWT, nil
}

func (c consultLiveKitRail) URL() string { return c.lk.ClientURL() }

func (c consultLiveKitRail) TokenTTL() time.Duration {
	if c.defaultTTL <= 0 {
		return consultengine.DefaultJoinTTL
	}
	return c.defaultTTL
}

// unavailableConsultMedia refuses every media call. It is installed when
// FEATURE_LIVEKIT_ENABLED is on but the client could not be built, so a consult
// fails loudly instead of pretending a room exists.
type unavailableConsultMedia struct{}

var _ consultengine.RoomMedia = unavailableConsultMedia{}

func (unavailableConsultMedia) EnsureRoom(context.Context, string) error {
	return consultengine.ErrMediaUnavailable
}
func (unavailableConsultMedia) CloseRoom(context.Context, string) error {
	return consultengine.ErrMediaUnavailable
}
func (unavailableConsultMedia) JoinToken(context.Context, string, string, consultengine.MediaRole, time.Duration) (string, error) {
	return "", consultengine.ErrMediaUnavailable
}
func (unavailableConsultMedia) URL() string             { return "" }
func (unavailableConsultMedia) TokenTTL() time.Duration { return consultengine.DefaultJoinTTL }

// consultMediaFor picks the media implementation: nil when the feature is off
// (sessions then fail closed with ErrMediaUnavailable), a refusing rail when the
// flag is on but the client is unusable, or the real rail.
func consultMediaFor(cfg config.Config, lk *livekit.Client) consultengine.RoomMedia {
	if !cfg.FeatureLiveKitEnabled {
		return nil
	}
	if lk == nil {
		return unavailableConsultMedia{}
	}
	return consultLiveKitRail{lk: lk, defaultTTL: time.Duration(cfg.LiveKitTokenTTLSeconds) * time.Second}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/app/ -run TestConsult -v`
Expected: PASS for the three tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/app/consult_livekit.go backend/internal/app/consult_livekit_test.go
git commit -m "feat(consult): prefix-guarded LiveKit rail with fail-closed media"
```

---

### Task 9: HTTP surface and wiring

**Files:**
- Create: `backend/internal/app/consult_routes.go`
- Test: `backend/internal/app/consult_routes_test.go`
- Modify: `backend/internal/app/finance_routes.go` (hoist the LiveKit client; register consult)

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces:
  - `RegisterConsult(r *gin.Engine, authMW gin.HandlerFunc, pool *pgxpool.Pool, ledgerSvc *ledger.Service, lk *livekit.Client, cfg config.Config, audit services.AuditService) *consultengine.Service`
  - Routes under `/api/v1/consult` (exact list below), all behind `authMW` + `requireUserID()` except the public package list.

- [ ] **Step 1: Write the failing handler tests**

Create `backend/internal/app/consult_routes_test.go`:

```go
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/health/consultengine"
)

type fakeConsultAPI struct {
	lastCaller string
	joinErr    error
	extErr     error
	session    consultengine.Session
	join       consultengine.Join
}

func (f *fakeConsultAPI) PublishPackage(_ context.Context, callerID string, p consultengine.Package) (consultengine.Package, error) {
	f.lastCaller = callerID
	p.ID = "pkg-1"
	return p, nil
}
func (f *fakeConsultAPI) ListPackages(context.Context, consultengine.Vertical, consultengine.OwnerKind, string) ([]consultengine.Package, error) {
	return []consultengine.Package{{ID: "pkg-1", DurationMinutes: 30, PriceKobo: 500_000}}, nil
}
func (f *fakeConsultAPI) Get(_ context.Context, _, callerID string) (consultengine.Session, error) {
	f.lastCaller = callerID
	return f.session, nil
}
func (f *fakeConsultAPI) Join(_ context.Context, _, callerID string) (consultengine.Join, error) {
	f.lastCaller = callerID
	return f.join, f.joinErr
}
func (f *fakeConsultAPI) Complete(_ context.Context, _, callerID string) error {
	f.lastCaller = callerID
	return nil
}
func (f *fakeConsultAPI) RequestExtension(_ context.Context, _, callerID string, minutes int) (consultengine.Extension, error) {
	f.lastCaller = callerID
	return consultengine.Extension{ID: "ext-1", AddedMinutes: minutes, Status: consultengine.ExtPending}, f.extErr
}
func (f *fakeConsultAPI) DecideExtension(_ context.Context, _, extID, callerID string, approve bool, _ string) (consultengine.Extension, error) {
	f.lastCaller = callerID
	return consultengine.Extension{ID: extID, Status: consultengine.ExtAwaitingPayment}, nil
}
func (f *fakeConsultAPI) PayExtension(context.Context, string, string, string) (consultengine.Extension, consultengine.Session, error) {
	return consultengine.Extension{ID: "ext-1", Status: consultengine.ExtPaid}, f.session, nil
}
func (f *fakeConsultAPI) PostMessage(_ context.Context, _, callerID, body string) (consultengine.Message, error) {
	f.lastCaller = callerID
	return consultengine.Message{ID: "m1", Body: body, CreatedAt: time.Now()}, nil
}
func (f *fakeConsultAPI) ListMessages(context.Context, string, string, time.Time) ([]consultengine.Message, error) {
	return []consultengine.Message{}, nil
}

func consultTestRouter(api consultAPI) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/consult/packages", (&consultHandler{svc: api}).listPackages) // public
	g := r.Group("/api/v1/consult")
	g.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-User")); c.Next() })
	registerConsultHandlers(g, api)
	return r
}

func doJSON(r *gin.Engine, method, path, user, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-User", user)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestConsultSessionRoutesUseTheAuthenticatedCaller(t *testing.T) {
	f := &fakeConsultAPI{session: consultengine.Session{ID: "s1", State: consultengine.StateScheduled}}
	r := consultTestRouter(f)

	w := doJSON(r, http.MethodGet, "/api/v1/consult/sessions/s1", "user-1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("get: %d %s", w.Code, w.Body.String())
	}
	if f.lastCaller != "user-1" {
		t.Fatalf("caller = %q, want user-1", f.lastCaller)
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/s1/join", "user-1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("join: %d %s", w.Code, w.Body.String())
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/s1/extensions", "user-1", `{"added_minutes":10}`)
	if w.Code != http.StatusOK {
		t.Fatalf("request extension: %d %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["success"] != true {
		t.Fatalf("envelope = %v", body)
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/s1/extensions/ext-1/decide", "doc-1", `{"approve":true}`)
	if w.Code != http.StatusOK {
		t.Fatalf("decide: %d %s", w.Code, w.Body.String())
	}
}

func TestConsultRoutesMapSentinelsToStatuses(t *testing.T) {
	f := &fakeConsultAPI{joinErr: consultengine.ErrMediaUnavailable}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodPost, "/api/v1/consult/sessions/s1/join", "user-1", "")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("media unavailable: %d, want 503", w.Code)
	}

	f2 := &fakeConsultAPI{extErr: consultengine.ErrInvalid}
	r2 := consultTestRouter(f2)
	w = doJSON(r2, http.MethodPost, "/api/v1/consult/sessions/s1/extensions", "user-1", `{"added_minutes":0}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad minutes: %d, want 400", w.Code)
	}

	f3 := &fakeConsultAPI{joinErr: consultengine.ErrState}
	r3 := consultTestRouter(f3)
	w = doJSON(r3, http.MethodPost, "/api/v1/consult/sessions/s1/join", "user-1", "")
	if w.Code != http.StatusConflict {
		t.Fatalf("ended session: %d, want 409", w.Code)
	}
}

func TestConsultPackageListIsPublicAndPackagesRequireAUser(t *testing.T) {
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/packages?vertical=vet", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("public list: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(r, http.MethodPost, "/api/v1/consult/packages", "doc-1",
		`{"owner_kind":"doctor","owner_id":"doc-1","vertical":"telemedicine","mode":"video","duration_minutes":30,"price_kobo":500000}`)
	if w.Code != http.StatusOK {
		t.Fatalf("publish: %d %s", w.Code, w.Body.String())
	}
	if f.lastCaller != "doc-1" {
		t.Fatalf("publish caller = %q", f.lastCaller)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/app/ -run TestConsult -v`
Expected: compile error `undefined: consultAPI` / `registerConsultHandlers`.

- [ ] **Step 3: Write the handlers**

Create `backend/internal/app/consult_routes.go`:

```go
package app

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/integrations/livekit"
	"spotlight/backend/internal/services"
)

var consultErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, consultengine.ErrInvalid),
	httperr.R(http.StatusNotFound, consultengine.ErrNotFound),
	httperr.R(http.StatusConflict, consultengine.ErrState,
		consultengine.ErrExtensionNotPayable, consultengine.ErrPaymentExpired),
	httperr.R(http.StatusServiceUnavailable, consultengine.ErrMediaUnavailable,
		consultengine.ErrEscrowUnavailable))

type consultAPI interface {
	PublishPackage(ctx context.Context, callerID string, pkg consultengine.Package) (consultengine.Package, error)
	ListPackages(ctx context.Context, vertical consultengine.Vertical, ownerKind consultengine.OwnerKind, ownerID string) ([]consultengine.Package, error)
	Get(ctx context.Context, sessionID, callerID string) (consultengine.Session, error)
	Join(ctx context.Context, sessionID, callerID string) (consultengine.Join, error)
	Complete(ctx context.Context, sessionID, callerID string) error
	RequestExtension(ctx context.Context, sessionID, callerID string, minutes int) (consultengine.Extension, error)
	DecideExtension(ctx context.Context, sessionID, extID, callerID string, approve bool, reason string) (consultengine.Extension, error)
	PayExtension(ctx context.Context, sessionID, extID, callerID string) (consultengine.Extension, consultengine.Session, error)
	PostMessage(ctx context.Context, sessionID, callerID, body string) (consultengine.Message, error)
	ListMessages(ctx context.Context, sessionID, callerID string, after time.Time) ([]consultengine.Message, error)
}

var _ consultAPI = (*consultengine.Service)(nil)

type consultHandler struct{ svc consultAPI }

func (h *consultHandler) listPackages(c *gin.Context) {
	vertical := consultengine.Vertical(c.Query("vertical"))
	items, err := h.svc.ListPackages(c.Request.Context(), vertical,
		consultengine.OwnerKind(c.Query("owner_kind")), c.Query("owner_id"))
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "packages": items})
}

type publishPackageBody struct {
	OwnerKind       string `json:"owner_kind"`
	OwnerID         string `json:"owner_id"`
	Vertical        string `json:"vertical"`
	Mode            string `json:"mode"`
	DurationMinutes int    `json:"duration_minutes"`
	PriceKobo       int64  `json:"price_kobo"`
	Active          *bool  `json:"active"`
}

func (h *consultHandler) publishPackage(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var b publishPackageBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	active := true
	if b.Active != nil {
		active = *b.Active
	}
	pkg, err := h.svc.PublishPackage(c.Request.Context(), caller, consultengine.Package{
		OwnerKind: consultengine.OwnerKind(b.OwnerKind), OwnerID: b.OwnerID,
		Vertical: consultengine.Vertical(b.Vertical), Mode: consultengine.Mode(b.Mode),
		DurationMinutes: b.DurationMinutes, PriceKobo: b.PriceKobo, Active: active,
	})
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "package": pkg})
}

func (h *consultHandler) getSession(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sess, err := h.svc.Get(c.Request.Context(), c.Param("id"), caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "session": sess})
}

func (h *consultHandler) join(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	j, err := h.svc.Join(c.Request.Context(), c.Param("id"), caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "token": j.Token, "rtc": j.RTC, "session": j.Session})
}

func (h *consultHandler) complete(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	if err := h.svc.Complete(c.Request.Context(), c.Param("id"), caller); err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *consultHandler) requestExtension(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var b struct {
		AddedMinutes int `json:"added_minutes"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	ext, err := h.svc.RequestExtension(c.Request.Context(), c.Param("id"), caller, b.AddedMinutes)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extension": ext})
}

func (h *consultHandler) decideExtension(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var b struct {
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	ext, err := h.svc.DecideExtension(c.Request.Context(), c.Param("id"), c.Param("ext"), caller, b.Approve, b.Reason)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extension": ext})
}

func (h *consultHandler) payExtension(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	ext, sess, err := h.svc.PayExtension(c.Request.Context(), c.Param("id"), c.Param("ext"), caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extension": ext, "session": sess})
}

func (h *consultHandler) listMessages(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var after time.Time
	if raw := c.Query("after"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "after must be RFC3339"})
			return
		}
		after = t
	}
	msgs, err := h.svc.ListMessages(c.Request.Context(), c.Param("id"), caller, after)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "messages": msgs})
}

func (h *consultHandler) postMessage(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var b struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	m, err := h.svc.PostMessage(c.Request.Context(), c.Param("id"), caller, b.Body)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": m})
}

// registerConsultHandlers mounts the routes on an already-authenticated group
// (the public package list is mounted on the engine's bare engine in RegisterConsult).
func registerConsultHandlers(g *gin.RouterGroup, api consultAPI) {
	h := &consultHandler{svc: api}
	g.GET("/sessions/:id", h.getSession)
	g.POST("/sessions/:id/join", h.join)
	g.POST("/sessions/:id/complete", h.complete)
	g.POST("/sessions/:id/extensions", h.requestExtension)
	g.POST("/sessions/:id/extensions/:ext/decide", h.decideExtension)
	g.POST("/sessions/:id/extensions/:ext/pay", h.payExtension)
	g.GET("/sessions/:id/messages", h.listMessages)
	g.POST("/sessions/:id/messages", h.postMessage)
	g.POST("/packages", h.publishPackage) // provider, still user-scoped
}

type consultEscrowAdapter struct{ e *escrow.Service }

func (a consultEscrowAdapter) HoldWithPayee(ctx context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (string, error) {
	h, err := a.e.HoldWithPayee(ctx, payerID, payeeID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return "", err
	}
	return h.ID, nil
}

func (a consultEscrowAdapter) Release(ctx context.Context, escrowID, payeeID string) error {
	return a.e.Release(ctx, escrowID, payeeID)
}

type consultAuditor struct{ a services.AuditService }

func (c consultAuditor) LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) {
	if c.a == nil {
		return
	}
	c.a.LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID, oldValues, newValues, ipAddress, userAgent, severity)
}

// RegisterConsult builds the engine and mounts /api/v1/consult. The public
// package list bypasses auth by design; every session route requires a user.
// The returned service is ready for RunSweeper.
func RegisterConsult(r *gin.Engine, authMW gin.HandlerFunc, pool *pgxpool.Pool, ledgerSvc *ledger.Service, lk *livekit.Client, cfg config.Config, audit services.AuditService) *consultengine.Service {
	if pool == nil {
		log.Println("[consult] nil pool — skipping consult routes")
		return nil
	}
	var esc consultengine.Escrow
	if ledgerSvc != nil {
		esc = consultEscrowAdapter{e: escrow.NewService(pool, ledgerSvc, nil)}
	}
	svc := consultengine.NewService(pool, consultMediaFor(cfg, lk), esc, consultAuditor{a: audit})

	pub := r.Group("/api/v1/consult")
	h := &consultHandler{svc: svc}
	pub.GET("/packages", h.listPackages)

	authed := r.Group("/api/v1/consult")
	authed.Use(authMW, requireUserID())
	registerConsultHandlers(authed, svc)

	log.Printf("[consult] mounted /api/v1/consult (media=%v, escrow=%v)",
		cfg.FeatureLiveKitEnabled, ledgerSvc != nil)
	return svc
}
```

- [ ] **Step 4: Wire it in `finance_routes.go`**

At the line where `ledgerSvc` is built (around line 199, `ledgerSvc := ledger.NewService(ledgerRepo, redisClient)`), add:

```go
	// One LiveKit client shared by academy live classes and paid health consults.
	// The constructor no-ops when FEATURE_LIVEKIT_ENABLED is off.
	lkClient := registerLiveKit(r, cfg, rbac, mapsAuth())
```

Then in the academy block replace:

```go
		academyLive := academyLiveRoomsFor(cfg, registerLiveKit(r, cfg, rbac, mapsAuth()))
```

with:

```go
		academyLive := academyLiveRoomsFor(cfg, lkClient)
```

After the health block (the `if cfg.FeatureHealthEnabled && pool != nil { … }` block), add:

```go
	// Paid consult sessions (telemedicine, vet, pharmacy, lab). Inert until a
	// module books a session; media fails closed when LiveKit is off.
	if pool != nil {
		if consultSvc := RegisterConsult(r, mapsAuth(), pool, ledgerSvc, lkClient, cfg, auditSink); consultSvc != nil {
			go consultSvc.RunSweeper(context.Background(), 30*time.Second)
		}
	}
```

`context` and `time` are already imported in `finance_routes.go`.

- [ ] **Step 5: Run the tests and full build**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend && go test ./internal/app/ -run TestConsult -v && go build ./... && go vet ./...
```
Expected: handler tests PASS; build and vet clean.

- [ ] **Step 6: Run the engine suite once more**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && TEST_DATABASE_URL="<your local test DSN>" go test ./internal/health/consultengine/ ./internal/integrations/livekit/ ./internal/app/ -v`
Expected: PASS (live-DB tests SKIP without the DSN).

- [ ] **Step 7: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/app/consult_routes.go backend/internal/app/consult_routes_test.go backend/internal/app/finance_routes.go
git commit -m "feat(consult): expose the shared consult API and start the sweeper"
```

---

### Task 10: Verification pass

**Files:**
- No new files. Read-only verification; fix only what fails.

**Interfaces:**
- Consumes: everything above.
- Produces: evidence that Slice 1 is complete and inert for existing flows.

- [ ] **Step 1: Confirm no existing flow changed**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main && git diff --stat origin/main...HEAD -- backend/internal/app/finance_routes.go && git log --oneline origin/main..HEAD
```
Expected: only the hoisted LiveKit client and the new consult block touch `finance_routes.go`; the nine commits from Tasks 1–9 are listed.

- [ ] **Step 2: Confirm inertness**

Run:
```bash
psql "$TEST_DATABASE_URL" -c "SELECT count(*) FROM consult_sessions;" -c "SELECT count(*) FROM consult_session_packages;"
```
Expected: both zero on a fresh database. No module starts a session in Slice 1, so no existing screen changes.

- [ ] **Step 3: Re-run the whole backend suite**

Run: `cd /Users/paymax/Documents/spotlight/main/backend && go test ./... 2>&1 | tail -40`
Expected: no new failures relative to `origin/main`. If a pre-existing failure appears, record it and do not "fix" it in this slice.

- [ ] **Step 4: Report**

Write the command outputs into the task report: role tests, engine tests, rail tests, handler tests, build/vet, and the inertness check. Do not claim completion without these outputs.

---

## Self-Review

**Spec coverage**
- Packages per mode/duration/price, snapshot on booking → Task 3 types, Task 4 `PublishPackage`/`Book`, tests assert the snapshot survives an edit.
- Server-authoritative timer, `min(5m, 20%)` warning → Task 3 `WarnLead`/`WarnAt`, Task 5 `Sweep`, test `TestSweepWarnsThenEndsAndIsIdempotent`.
- 0:00 cuts media, stays signed in, chat readable → Task 5 `endSession`, Task 7 test asserts posting fails at `ends_at` while listing still works.
- Either side extends; patient extension needs approval then payment → Task 6 all three tests.
- Provider extension free and immediate → Task 6 `TestProviderExtensionAppliesImmediatelyAndFree`.
- Escrow hold + release, pinned payee, idempotent key `consult-ext:<id>` → Task 6 `PayExtension`, `releaseExtensions`; test asserts the key and the release.
- Rail prefix, `RolePeer`, room-admin for provider, TTL cap → Tasks 2, 3 (`JoinTTL`), 5 (`Join`), 8 (rail tests).
- Fail closed when flag on but unusable → Task 8 `unavailableConsultMedia`, test `TestConsultMediaFailsClosed`.
- 4-hour extension ceiling, 5-minute payment window → Tasks 3/6 constants and tests.
- Non-participant fold to 404 → Task 4 `TestGetFoldsNonParticipantsToNotFound`, Task 6/7 stranger cases, Task 9 handler status test.
- Legacy fallbacks (20m telemedicine / 30m vet) → not implemented in Slice 1; they are exercised when modules book without a package in Slice 2. Recorded here as an explicit deferral, not a gap.
- No UI changes in Slice 1 → File Structure contains no mobile files.

**Placeholder scan**
- No `TBD`/`TODO`/"implement later". The one temporary function (`releaseExtensions` no-op in Task 5) is explicitly deleted in Task 6 and the deletion is a step.
- Empty `strconv` import note in Task 9 is an explicit removal instruction, not dead code left behind.

**Type consistency**
- `consultengine.RoomMedia` methods (`EnsureRoom`, `CloseRoom`, `JoinToken`, `URL`, `TokenTTL`) match the rail and the unavailable implementation.
- `Escrow.HoldWithPayee/Release/Refund` match the app adapter and the `fakeEscrow` test double.
- `consultAPI` in Task 9 matches `*consultengine.Service` method signatures from Tasks 4–7; `var _ consultAPI = (*consultengine.Service)(nil)` enforces it at compile time.
- `OwnerKind`/`OwnerDoctor` vs `OwnerHealthProvider` are consistent across `verifyOwner`, `verifyProviderUser`, and the schema CHECK values.
- `MediaPeer`/`MediaPeerAdmin` map to `livekit.RolePeer`/`RolePeerAdmin` in Task 8.
- Extension statuses match the schema CHECK list exactly.

**Known risk to watch at execution**
- Task 4's live test uses `auth.users`, `health_providers`, and the new tables; the migration must be applied to `TEST_DATABASE_URL` first (Task 1, Step 3).
- `escrow` live tests are intentionally not written: the engine is tested against `fakeEscrow` so Slice 1 never seeds wallets or moves money in CI.

---

## Post-review amendment: money-safe extension payment (2026-11-04)

Task 6's `PayExtension` / `releaseExtensions` code blocks are **superseded** by
the shipped implementation in commits `36e7d41cd`, `6384b7a77`, and `ecaa93064`.
The code review chain established that refund-then-rehold under a deterministic
escrow key is unsafe (escrow's idempotent replay returns the REFUNDED row), and
that every compensation must win a status-guarded claim before moving money.
The shipped invariants:

- `Escrow` declares `Refund(ctx, escrowID) error` alongside `HoldWithPayee` and
  `Release`.
- A recorded `escrow_id` on an `approved_awaiting_payment` row **is** this
  request's hold: adopt it. Never refund it and re-hold under
  `consult-ext:<extension id>`.
- `markPaid` requires `status='approved_awaiting_payment' AND escrow_id IS NOT
  DISTINCT FROM <this attempt's hold>`, and grants the minutes in the same
  transaction via `applyExtensionOn` (`ends_at = GREATEST(ends_at, now) +
  minutes`, then recompute `warn_at` and reset `warning_sent_at`).
- Every failure path goes through `retireUnapplied`, which claims the row with a
  status-guarded update (`status IN ('approved_awaiting_payment','expired')` and
  the hold-id guard) **before** refunding. Zero affected rows means another
  attempt owns the outcome: no refund, no adoption. A successful refund clears
  `escrow_id` and stamps `released_at`; a failed refund leaves `expired` plus
  `escrow_id` for the sweep's refund lane.
- The escrow-stamp error branch (`extensions.go`, the `record extension hold`
  failure) follows the same rule: it claims the row before refunding, because
  the failed stamp may have landed and a concurrent attempt may have committed
  the row `paid`. Only a claim of exactly one row permits the refund.
- `releaseExtensions` settles `paid` rows with `Release` to the provider and
  `expired` rows with `Refund` to the patient, stamping `released_at` after each
  so nothing settles twice (escrow forbids `REFUNDED → REFUNDED`).
- Provider grants are free (`price_kobo=0`, status `paid`) and are applied
  atomically with the row insert. Free patient extensions never require escrow
  wiring (`PriceKobo > 0 && s.esc == nil` is the only unavailability check).

Tests pinning these invariants: `TestPayExtensionRefundsWhenTheSessionEndsMidPayment`,
`TestConcurrentProviderGrantAndPaidExtensionKeepBothIncrements`,
`TestExtensionPaymentIsRefusedAfterComplete`,
`TestApprovalIsRefusedAfterComplete`, `TestFreePriceExtensionNeedsNoEscrow`,
`TestExpiredHeldExtensionIsRefundedAtSessionEnd`,
`TestPayReusesARecordedHoldAfterACrash`,
`TestTwoConcurrentPaymentsChargeOnceAndApplyOnce`, and
`TestFailedStampClaimsThenRefundsTheHold` (a `BEFORE UPDATE` trigger rejects
only the stamp, deterministically driving the branch).
