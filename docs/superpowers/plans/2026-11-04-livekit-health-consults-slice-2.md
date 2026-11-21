# LiveKit Health Consults — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make telemedicine and veterinary appointments sell timed LiveKit sessions: providers publish per-mode/per-duration packages, a booking pins one, the module starts a `consult_sessions` row from its own committed appointment, and a shared `ConsultRoom` on web and native renders the server timer, cuts media at 0:00, keeps chat read-only, and runs the approve-then-pay extension flow.

**Architecture:** Slice 1's `consultengine` stays the single owner of session lifecycle and money. Slice 2 adds exactly three engine capabilities the modules need — idempotent creation keyed to the appointment (`(vertical, source_ref)`), a `PriceSnapshot` for legacy appointments that have no published package, and one read/complete pair (`ListExtensions`, `CompleteBySource`). Each module keeps its own booking, escrow and settlement; it only pins a package on the booking row and calls `EnsureSession` when a party opens the room. Media selection moves to `CONSULT_MEDIA_PROVIDER` so VideoSDK remains a one-env-var rollback. The mobile side gains one shared `src/features/consult/` client — timer math, polling hooks, platform-split media, `ConsultRoom`, `PackagePicker` — consumed by both modules' screens.

**Tech Stack:** Go 1.2x, gin, pgx/v5, LiveKit server SDK (`internal/integrations/livekit`), existing `escrow` + `ledger` money rail, Postgres migrations under `supabase/migrations`; Expo Router, React Query v5, `livekit-client ^2.22.4`, `@livekit/react-native ^3.0.0`, the existing `usePurchasePayment` / `PaymentSheet` money UI.

**Spec:** `docs/superpowers/specs/2026-11-04-livekit-health-consults-design.md`

## Global Constraints

- Migration is additive only: `CREATE INDEX IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`; no `DROP`, no column narrowing. Wrap in `BEGIN; … COMMIT;`.
- New tables and columns stay RLS-enabled with **no** anon/authenticated policies; every read/write goes through the Go pool, which owns participant scoping.
- One session per appointment: the unique index on `consult_sessions (vertical, source_ref)` is the replay anchor. A second creation with a different price or participant is `ErrState`, never a second room.
- Money is computed server-side in kobo. A client-supplied price is only ever compared (`expected_total_kobo`), never trusted.
- Non-participants get `404` on every session path — never `403` (do not confirm existence).
- Room names are `consult-<vertical>-<session uuid>`; the rail refuses any name without the `consult-` prefix.
- Media fails closed: LiveKit on but client unusable ⇒ `503` sentinel, never a token for a room the rail did not create.
- Rollback is config, not code: `CONSULT_MEDIA_PROVIDER=livekit|videosdk`. `videosdk` leaves the consult engine unwired, so the existing VideoSDK screens keep working unchanged.
- Existing routes and screens are never modified destructively. Timed rooms are **new sibling routes**; the legacy screens stay reachable as the rollback path.
- Every backend task ends with `go build ./... && go vet ./...` green. Live-DB tests skip when `TEST_DATABASE_URL` is unset.
- Every mobile task ends with `npm run typecheck` green from `mobile-app/reactnative`, plus the task's node tests.
- Stage only files named in the task; never `frontend-web/node_modules`, never `frontend-admin/next-env.d.ts`.
- Work in the isolated worktree. The shell cwd resets after each command, so pass absolute paths; where a step says `/Users/paymax/Documents/spotlight/main`, substitute the worktree root and commit there, never in the main checkout.

## File Structure

```
supabase/migrations/20271406000000_consult_slice2.sql          one-session-per-source + module package pins
backend/internal/health/consultengine/session_scan.go          rowScanner, sessionColumns, scanSession
backend/internal/health/consultengine/scan_test.go             pure scanner test
backend/internal/health/consultengine/packages.go              + packageColumns/scanPackage/GetPackage
backend/internal/health/consultengine/sessions.go              + loadBySource, EnsureSession, CompleteBySource
backend/internal/health/consultengine/booking.go               resolveBooking + resolveBookPrice + assertSameBooking
backend/internal/health/consultengine/booking_test.go          pure pricing/replay tests
backend/internal/health/consultengine/extensions.go            + ListExtensions (scanExtension widened)
backend/internal/health/consultengine/types.go                 + PriceSnapshot, EarlyJoinWindow
backend/internal/health/consultengine/engine_slice2_live_db_test.go  idempotency, snapshot, guard, complete, list
backend/internal/app/consult_routes.go                         + GET /packages/:id, GET /sessions/:id/extensions
backend/internal/app/consult_routes_test.go                    + fake methods and route tests
backend/internal/telemedicine/model.go                         + Doctor.Packages, BookAppointmentRequest.PackageID
backend/internal/telemedicine/service.go                       + package listing, package-priced booking, OpenConsultSession
backend/internal/telemedicine/handler.go                       + OpenConsultSession, package error mapping
backend/internal/telemedicine/service_live_db_test.go          booking/session tests (gated)
backend/internal/health/vet/service.go                         + package pricing, EnsureConsultSession, WithConsultRoomEngine
backend/internal/health/vet/types.go                           + ErrNotTeleconsult, ErrConsultNotReady, ErrPackage*
backend/internal/health/vetapi/owner/appts.go                  + packageId/expectedTotalKobo, session route
backend/internal/health/vetapi/owner/register.go               + POST /appointments/:id/consult-session
backend/internal/health/vetapi/provider/wire.go                + ProviderID
backend/internal/health/vetapi/provider/profile.go             + out.ProviderID = p.ID
backend/internal/config/config.go                              + ConsultMediaProvider
backend/internal/app/finance_routes.go                         hoist RegisterConsult, gate injection on provider
backend/internal/app/health_vet_routes.go                      pass the engine into RegisterHealthVet
mobile-app/reactnative/src/features/consult/types.ts           wire + mapped consult types
mobile-app/reactnative/src/features/consult/api.ts             /api/v1/consult + module open-session calls
mobile-app/reactnative/src/features/consult/sessionTimer.ts    server-clock + phase math
mobile-app/reactnative/src/features/consult/__tests__/sessionTimer.test.ts
mobile-app/reactnative/src/features/consult/hooks.ts           React Query polling + mutations
mobile-app/reactnative/src/features/consult/useConsultMedia.ts        web LiveKit session
mobile-app/reactnative/src/features/consult/useConsultMedia.native.ts native LiveKit session
mobile-app/reactnative/src/features/consult/ConsultVideo.tsx          web <video> renderer
mobile-app/reactnative/src/features/consult/ConsultVideo.native.tsx   native <VideoTrack> renderer
mobile-app/reactnative/src/features/consult/ConsultRoom.tsx           shared timed room
mobile-app/reactnative/src/features/consult/roomView.ts               pure room-state mapping
mobile-app/reactnative/src/features/consult/__tests__/roomView.test.ts
mobile-app/reactnative/src/features/consult/ExtensionSheet.tsx        request/approve/pay sheet
mobile-app/reactnative/src/features/consult/PackagePicker.tsx         mode/duration/price selector
mobile-app/reactnative/src/features/consult/packages.ts               provider package drafts
mobile-app/reactnative/src/features/consult/__tests__/packages.test.ts
mobile-app/reactnative/src/features/consult/index.ts                  barrel
mobile-app/reactnative/src/types/telemedicine.ts               + DoctorPackage, packageId
mobile-app/reactnative/src/api/telemedicine.api.ts             package_id on booking
mobile-app/reactnative/app/services/telemedicine/doctor/[id]/book.tsx  package picker
mobile-app/reactnative/app/services/telemedicine/book/confirm.tsx      package quote
mobile-app/reactnative/app/services/telemedicine/consult/[id]/room.tsx patient timed room
mobile-app/reactnative/app/services/telemedicine/consult/[id].tsx      legacy videosdk room (untouched, rollback)
mobile-app/reactnative/app/services/telemedicine/appointment/[id].tsx  join → timed room
mobile-app/reactnative/app/services/telemedicine/book/success.tsx      join → timed room
mobile-app/reactnative/app/(doctor)/consult/[id]/room.tsx       provider timed room
mobile-app/reactnative/app/(doctor)/consult/packages.tsx        doctor package pricing
mobile-app/reactnative/src/features/health/vet/types.ts        + providerId, packageId, expectedTotalKobo, consultMode
mobile-app/reactnative/src/features/health/vet/vetListing.ts   + packages off the public listing
mobile-app/reactnative/src/features/health/vet/__tests__/vetListing.test.ts  package carry-through
mobile-app/reactnative/app/health/vet/book.tsx                 vet package picker
mobile-app/reactnative/app/health/vet/checkout.tsx             package price + expected total
mobile-app/reactnative/app/health/vet/teleconsult-lobby.tsx    bootstrap timed session
mobile-app/reactnative/app/health/vet/timed-consult.tsx        patient timed room
mobile-app/reactnative/app/health/vet/provider/timed-consult.tsx provider timed room
mobile-app/reactnative/app/health/vet/provider/packages.tsx    vet package pricing
mobile-app/reactnative/app/health/vet/_layout.tsx              timed room + pricing routes
mobile-app/reactnative/app/health/vet/provider/pet-chart.tsx   Start consult → timed room
mobile-app/reactnative/app/health/vet/provider/profile.tsx     prices shortcut
mobile-app/reactnative/package.json                            + test:consult
```

---

### Task 1: Slice 2 schema — one session per appointment, module package pins

**Files:**
- Create: `supabase/migrations/20271406000000_consult_slice2.sql`
- Modify: nothing (existing tables only gain nullable columns)
- Test: replay + column/index checks (commands below)

**Interfaces:**
- Consumes: `consult_sessions`, `consult_session_packages` (Slice 1), `appointments`, `vet_appointment_payments`.
- Produces: unique index `uq_consult_sessions_source` on `(vertical, source_ref)`; `appointments.consult_package_id` / `consult_mode` / `consult_duration_minutes`; `vet_appointment_payments.consult_package_id` / `consult_mode` / `consult_duration_minutes`.

- [ ] **Step 1: Confirm the migration version is still free**

Run:
```bash
ls /Users/paymax/Documents/spotlight/main/supabase/migrations | tail -3
ls /Users/paymax/Documents/spotlight/main/supabase/migrations | grep '^20271406' || true
```
Expected: `20271406000000_consult_slice2.sql` does not exist. If it does, or a newer migration sorts after it, bump by `10000` and use that filename everywhere in this plan.

- [ ] **Step 2: Prove the new unique index cannot fail on existing data**

Run against the local DB:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "SELECT vertical, source_ref, count(*) FROM public.consult_sessions GROUP BY 1,2 HAVING count(*) > 1;"
```
Expected: `(0 rows)`. Any row here is a duplicate an earlier partial rollout created; resolve it (keep the oldest, delete the rest after confirming no extension rows reference the extras) before applying.

- [ ] **Step 3: Write the migration**

```sql
-- Slice 2: one live consult session per module appointment, and the module
-- booking row's pin to the price point the patient picked. The duration is
-- copied onto the booking row too: a package price may be edited later, and a
-- session must always last what the patient paid for.
-- ADDITIVE-ONLY: one index + six nullable columns.
BEGIN;

-- The replay anchor. A retried open-session call converges on the row this
-- index protects instead of minting a second room (see EnsureSession).
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_sessions_source
  ON public.consult_sessions (vertical, source_ref);

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS consult_package_id uuid
    REFERENCES public.consult_session_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consult_mode text
    CONSTRAINT appointments_consult_mode_check
    CHECK (consult_mode IN ('chat','voice','video')),
  ADD COLUMN IF NOT EXISTS consult_duration_minutes int
    CONSTRAINT appointments_consult_duration_check
    CHECK (consult_duration_minutes BETWEEN 5 AND 480);

ALTER TABLE public.vet_appointment_payments
  ADD COLUMN IF NOT EXISTS consult_package_id uuid
    REFERENCES public.consult_session_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consult_mode text
    CONSTRAINT vet_appt_consult_mode_check
    CHECK (consult_mode IN ('chat','voice','video')),
  ADD COLUMN IF NOT EXISTS consult_duration_minutes int
    CONSTRAINT vet_appt_consult_duration_check
    CHECK (consult_duration_minutes BETWEEN 5 AND 480);

COMMIT;
```

- [ ] **Step 4: Apply and prove idempotence**

Run:
```bash
supabase migration up --include-all
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f /Users/paymax/Documents/spotlight/main/supabase/migrations/20271406000000_consult_slice2.sql
```
Expected: `supabase` reports the migration applied; the second run prints `CREATE INDEX` / `ALTER TABLE` with no error, proving the file is replay-safe.

- [ ] **Step 5: Verify the columns and index exist**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_name IN ('appointments','vet_appointment_payments')
  AND column_name IN ('consult_package_id','consult_mode','consult_duration_minutes')
ORDER BY table_name, column_name;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT indexname FROM pg_indexes
WHERE tablename='consult_sessions' AND indexname='uq_consult_sessions_source';"
```
Expected: six column rows (all `YES` nullable) and one index row.

- [ ] **Step 6: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add supabase/migrations/20271406000000_consult_slice2.sql
git commit -m "feat(consult): one session per appointment, module package pins"
```

---

### Task 2: Engine readers — one scanner, source lookup, single package read

**Files:**
- Create: `backend/internal/health/consultengine/session_scan.go`
- Create: `backend/internal/health/consultengine/scan_test.go`
- Create: `backend/internal/health/consultengine/engine_slice2_live_db_test.go`
- Modify: `backend/internal/health/consultengine/service.go` (`load`)
- Modify: `backend/internal/health/consultengine/sessions.go` (`Book` RETURNING, `Sweep` SELECT loop)
- Modify: `backend/internal/health/consultengine/packages.go` (`PublishPackage`, `ListPackages`, add `GetPackage`)

**Interfaces:**
- Consumes: `consult_sessions` and `consult_session_packages` (Task 1 applied), `Service.db`.
- Produces:
  - `type rowScanner interface { Scan(dest ...any) error }`
  - `const sessionColumns string`, `func scanSession(row rowScanner) (Session, error)`
  - `func (s *Service) loadBySource(ctx context.Context, vertical Vertical, sourceRef string) (Session, error)`
  - `const packageColumns string`, `func scanPackage(row rowScanner) (Package, error)`
  - `func (s *Service) GetPackage(ctx context.Context, id string) (Package, error)` — active rows only, `ErrNotFound` otherwise.

- [ ] **Step 1: Write the failing pure scanner test**

Create `backend/internal/health/consultengine/scan_test.go`:

```go
package consultengine

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

// stubRow assigns values positionally, so a scanner can be tested without a DB.
type stubRow struct{ values []any }

func (s stubRow) Scan(dest ...any) error {
	if len(dest) != len(s.values) {
		return fmt.Errorf("scan: %d destinations, %d values", len(dest), len(s.values))
	}
	for i := range dest {
		target := reflect.ValueOf(dest[i]).Elem()
		src := reflect.ValueOf(s.values[i])
		if !src.IsValid() {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		if !src.Type().AssignableTo(target.Type()) {
			return fmt.Errorf("scan: value %d is %s, want %s", i, src.Type(), target.Type())
		}
		target.Set(src)
	}
	return nil
}

func TestScanSessionMapsEnumsAndNullables(t *testing.T) {
	start := time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC)
	pkg, hold := "pkg-1", "hold-1"
	row := stubRow{values: []any{
		"id-1", "vet", "video", "patient-1", "health_provider", "owner-1", "provider-1",
		"vet:appt-1", &pkg, 30, int64(500_000), start, start.Add(30 * time.Minute),
		start.Add(25 * time.Minute), (*time.Time)(nil), "live", "consult-vet-id-1", &hold,
		(*time.Time)(nil),
	}}
	sess, err := scanSession(row)
	if err != nil {
		t.Fatalf("scanSession: %v", err)
	}
	if sess.Vertical != VerticalVet || sess.Mode != ModeVideo || sess.State != StateLive {
		t.Fatalf("enums = %q/%q/%q", sess.Vertical, sess.Mode, sess.State)
	}
	if sess.ProviderOwnerKind != OwnerHealthProvider {
		t.Fatalf("owner kind = %q", sess.ProviderOwnerKind)
	}
	if sess.PackageID == nil || *sess.PackageID != "pkg-1" {
		t.Fatalf("package id = %v", sess.PackageID)
	}
	if sess.BaseHoldID == nil || *sess.BaseHoldID != "hold-1" {
		t.Fatalf("hold id = %v", sess.BaseHoldID)
	}
	if sess.WarningSentAt != nil || sess.EndedAt != nil {
		t.Fatalf("nullable timestamps = %v / %v", sess.WarningSentAt, sess.EndedAt)
	}
	if !sess.EndsAt.Equal(start.Add(30 * time.Minute)) {
		t.Fatalf("ends_at = %v", sess.EndsAt)
	}
}

func TestScanSessionRejectsAWidthMismatch(t *testing.T) {
	if _, err := scanSession(stubRow{values: []any{"only-one"}}); err == nil {
		t.Fatal("a short row must error rather than silently zero the session")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/health/consultengine -run 'TestScanSession' -count=1
```
Expected: FAIL — `undefined: scanSession`.

- [ ] **Step 3: Write `session_scan.go`**

```go
package consultengine

// rowScanner is satisfied by pgx.Row and pgx.Rows, so one scanner serves every
// read path: single-row loads, RETURNING clauses and the sweeper's multi-row read.
type rowScanner interface {
	Scan(dest ...any) error
}

// sessionColumns is the canonical SELECT/RETURNING list for consult_sessions.
// Every read in this package uses it so scanSession can never drift from a query.
const sessionColumns = `id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	booked_start, ends_at, warn_at, warning_sent_at, state, room_name,
	base_hold_id, ended_at`

func scanSession(row rowScanner) (Session, error) {
	var sess Session
	var vertical, mode, ownerKind, state string
	err := row.Scan(&sess.ID, &vertical, &mode, &sess.PatientID, &ownerKind,
		&sess.ProviderOwnerID, &sess.ProviderUserID, &sess.SourceRef, &sess.PackageID,
		&sess.DurationMinutes, &sess.PriceKobo, &sess.BookedStart, &sess.EndsAt,
		&sess.WarnAt, &sess.WarningSentAt, &state, &sess.RoomName,
		&sess.BaseHoldID, &sess.EndedAt)
	if err != nil {
		return Session{}, err
	}
	sess.Vertical, sess.Mode = Vertical(vertical), Mode(mode)
	sess.ProviderOwnerKind, sess.State = OwnerKind(ownerKind), State(state)
	return sess, nil
}
```

- [ ] **Step 4: Refactor the existing readers onto the scanner**

In `service.go`, replace the whole body of `load` with:

```go
// load reads one session without authorization. Callers must scope it.
func (s *Service) load(ctx context.Context, sessionID string) (Session, error) {
	q := `SELECT ` + sessionColumns + ` FROM consult_sessions WHERE id=$1`
	sess, err := scanSession(s.db.QueryRow(ctx, q, sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load session: %w", err)
	}
	return sess, nil
}
```

Immediately below it add:

```go
// loadBySource finds the one session pinned to a module appointment. The unique
// index on (vertical, source_ref) guarantees at most one row.
func (s *Service) loadBySource(ctx context.Context, vertical Vertical, sourceRef string) (Session, error) {
	q := `SELECT ` + sessionColumns + ` FROM consult_sessions WHERE vertical=$1 AND source_ref=$2`
	sess, err := scanSession(s.db.QueryRow(ctx, q, vertical, sourceRef))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: load session by source: %w", err)
	}
	return sess, nil
}
```

In `sessions.go`, replace the `INSERT … RETURNING …` column list and manual scan in `Book` with:

```go
	const q = `INSERT INTO consult_sessions
	             (id, vertical, mode, patient_id, provider_owner_kind, provider_owner_id,
	              provider_user_id, source_ref, package_id, duration_minutes, price_kobo,
	              booked_start, ends_at, warn_at, state, room_name, base_hold_id)
	           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'scheduled',$15,$16)
	           RETURNING ` + sessionColumns
	var hold *string
	if strings.TrimSpace(req.BaseHoldID) != "" {
		hold = &req.BaseHoldID
	}
	sess, err := scanSession(s.db.QueryRow(ctx, q, id, req.Vertical, req.Mode, req.PatientID,
		req.ProviderOwnerKind, req.ProviderOwnerID, req.ProviderUserID, req.SourceRef,
		req.PackageID, duration, price, start, ends, warn, room, hold))
	if err != nil {
		return Session{}, fmt.Errorf("consult: book session: %w", err)
	}
```

Delete the now-unused `var vertical, mode, ownerKind, state string` declarations in `Book`.

In `Sweep`, replace the due-session query and its scan block with:

```go
	rows, err := s.db.Query(ctx, `SELECT `+sessionColumns+`
	                              FROM consult_sessions
	                              WHERE state IN ('scheduled','live') AND ends_at <= $1`, now)
	if err != nil {
		return fmt.Errorf("consult: sweep due sessions: %w", err)
	}
	var due []Session
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			rows.Close()
			return err
		}
		due = append(due, sess)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
```

- [ ] **Step 5: Add package scanning and `GetPackage`**

In `packages.go`, add above `PublishPackage`:

```go
const packageColumns = `id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active, created_at`

func scanPackage(row rowScanner) (Package, error) {
	var p Package
	var ownerKind, vertical, mode string
	if err := row.Scan(&p.ID, &ownerKind, &p.OwnerID, &vertical, &mode,
		&p.DurationMinutes, &p.PriceKobo, &p.Active, &p.CreatedAt); err != nil {
		return Package{}, err
	}
	p.OwnerKind, p.Vertical, p.Mode = OwnerKind(ownerKind), Vertical(vertical), Mode(mode)
	return p, nil
}

// GetPackage returns one ACTIVE price point to any signed-in reader. An inactive
// package cannot start a session, so it is folded into not-found rather than
// advertising a price nobody can buy.
func (s *Service) GetPackage(ctx context.Context, id string) (Package, error) {
	q := `SELECT ` + packageColumns + ` FROM consult_session_packages WHERE id=$1 AND active=true`
	p, err := scanPackage(s.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Package{}, ErrNotFound
	}
	if err != nil {
		return Package{}, fmt.Errorf("consult: load package: %w", err)
	}
	return p, nil
}
```

In `PublishPackage`, replace the RETURNING list and manual scan with:

```go
	const q = `INSERT INTO consult_session_packages
	             (owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active)
	           VALUES ($1,$2,$3,$4,$5,$6,$7)
	           ON CONFLICT (owner_kind, owner_id, vertical, mode, duration_minutes)
	           DO UPDATE SET price_kobo=EXCLUDED.price_kobo, active=EXCLUDED.active, updated_at=now()
	           RETURNING ` + packageColumns
	out, err := scanPackage(s.db.QueryRow(ctx, q, pkg.OwnerKind, pkg.OwnerID, pkg.Vertical,
		pkg.Mode, pkg.DurationMinutes, pkg.PriceKobo, pkg.Active))
	if err != nil {
		return Package{}, fmt.Errorf("consult: publish package: %w", err)
	}
	return out, nil
```

In `ListPackages`, replace the body of the row loop with:

```go
	for rows.Next() {
		p, err := scanPackage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
```

- [ ] **Step 6: Run the pure tests and the build**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/health/consultengine -run 'TestScanSession' -count=1
go build ./... && go vet ./...
```
Expected: `ok … consultengine`; build and vet clean.

- [ ] **Step 7: Add the live-DB reader tests**

Create `backend/internal/health/consultengine/engine_slice2_live_db_test.go`:

```go
package consultengine

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestLoadBySourceAndGetPackage(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)

	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-scan", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	bySource, err := f.svc.loadBySource(context.Background(), VerticalVet, "vet:appt-scan")
	if err != nil {
		t.Fatalf("load by source: %v", err)
	}
	if bySource.ID != sess.ID || bySource.PriceKobo != 500_000 {
		t.Fatalf("load by source = %s / %d", bySource.ID, bySource.PriceKobo)
	}
	if _, err := f.svc.loadBySource(context.Background(), VerticalVet, "vet:nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing source: err = %v, want ErrNotFound", err)
	}

	got, err := f.svc.GetPackage(context.Background(), pkg.ID)
	if err != nil {
		t.Fatalf("get package: %v", err)
	}
	if got.ID != pkg.ID || got.Mode != ModeVideo || got.DurationMinutes != 30 {
		t.Fatalf("package = %+v", got)
	}
	if _, err := f.svc.GetPackage(context.Background(), uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing package: err = %v, want ErrNotFound", err)
	}

	// An inactive package disappears from the public read.
	if _, err := f.svc.PublishPackage(context.Background(), f.providerID, Package{
		OwnerKind: OwnerHealthProvider, OwnerID: f.providerRow, Vertical: VerticalVet,
		Mode: ModeVideo, DurationMinutes: 30, PriceKobo: 500_000, Active: false,
	}); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	if _, err := f.svc.GetPackage(context.Background(), pkg.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("inactive package: err = %v, want ErrNotFound", err)
	}
}
```

- [ ] **Step 8: Run the live test**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/health/consultengine -run 'TestLoadBySourceAndGetPackage|TestScanSession' -count=1 -v
```
Expected: both PASS. Without `TEST_DATABASE_URL` the live test SKIPs, which is not a substitute — run it once against the migrated local DB.

- [ ] **Step 9: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/consultengine/session_scan.go \
        backend/internal/health/consultengine/scan_test.go \
        backend/internal/health/consultengine/engine_slice2_live_db_test.go \
        backend/internal/health/consultengine/service.go \
        backend/internal/health/consultengine/sessions.go \
        backend/internal/health/consultengine/packages.go
git commit -m "refactor(consult): one session scanner, source lookup, single package read"
```

---

### Task 3: Engine writes — idempotent creation, price snapshots, completion by source, extension list

**Files:**
- Create: `backend/internal/health/consultengine/booking.go`
- Create: `backend/internal/health/consultengine/booking_test.go`
- Modify: `backend/internal/health/consultengine/types.go` (`PriceSnapshot`, `EarlyJoinWindow`)
- Modify: `backend/internal/health/consultengine/sessions.go` (`Book`, `Join`, `CompleteBySource`)
- Modify: `backend/internal/health/consultengine/extensions.go` (`scanExtension`, `ListExtensions`)
- Modify: `backend/internal/health/consultengine/engine_slice2_live_db_test.go` (append tests)

**Interfaces:**
- Consumes: `sessionColumns`/`scanSession`/`loadBySource` (Task 2), `uq_consult_sessions_source` (Task 1).
- Produces:
  - `type PriceSnapshot struct { DurationMinutes int; PriceKobo int64 }`
  - `BookRequest.Snapshot *PriceSnapshot`; `BookRequest.PackageID` may now be empty when `Snapshot` is set.
  - `func (s *Service) EnsureSession(ctx context.Context, req BookRequest) (Session, error)`
  - `func (s *Service) CompleteBySource(ctx context.Context, vertical Vertical, sourceRef, callerID string) error`
  - `func (s *Service) ListExtensions(ctx context.Context, sessionID, callerID string) ([]Extension, error)`
  - `const EarlyJoinWindow = 10 * time.Minute`

- [ ] **Step 1: Write the failing pure tests**

Create `backend/internal/health/consultengine/booking_test.go`:

```go
package consultengine

import (
	"errors"
	"testing"
)

func TestResolveBookPrice(t *testing.T) {
	snap := &PriceSnapshot{DurationMinutes: 20, PriceKobo: 300_000}
	cases := []struct {
		name       string
		dur        int
		price      int64
		active     bool
		snap       *PriceSnapshot
		wantDur    int
		wantPrice  int64
		wantErr    bool
	}{
		{"active package", 30, 500_000, true, nil, 30, 500_000, false},
		{"inactive package without snapshot", 30, 500_000, false, nil, 0, 0, true},
		{"snapshot without package", 0, 0, false, snap, 20, 300_000, false},
		{"snapshot wins over package price", 20, 900_000, true, snap, 20, 300_000, false},
		{"snapshot duration disagrees with package", 30, 500_000, true, snap, 0, 0, true},
		{"zero snapshot price", 0, 0, false, &PriceSnapshot{DurationMinutes: 20}, 0, 0, true},
		{"snapshot below the duration floor", 0, 0, false, &PriceSnapshot{DurationMinutes: 1, PriceKobo: 100}, 0, 0, true},
		{"snapshot above the price ceiling", 0, 0, false, &PriceSnapshot{DurationMinutes: 20, PriceKobo: 100_000_001}, 0, 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, p, err := resolveBookPrice(tc.dur, tc.price, tc.active, tc.snap)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalid) {
					t.Fatalf("err = %v, want ErrInvalid", err)
				}
				return
			}
			if err != nil || d != tc.wantDur || p != tc.wantPrice {
				t.Fatalf("got %d/%d/%v, want %d/%d", d, p, err, tc.wantDur, tc.wantPrice)
			}
		})
	}
}

func TestAssertSameBooking(t *testing.T) {
	pkg := "pkg-1"
	base := Session{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: "patient-1",
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: "owner-1",
		ProviderUserID: "provider-1", SourceRef: "vet:appt-1", PackageID: &pkg,
		DurationMinutes: 30, PriceKobo: 500_000,
	}
	req := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: "patient-1",
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: "owner-1",
		ProviderUserID: "provider-1", SourceRef: "vet:appt-1", PackageID: pkg,
	}
	if err := assertSameBooking(base, req, 30, 500_000); err != nil {
		t.Fatalf("identical booking: %v", err)
	}
	if err := assertSameBooking(base, req, 30, 400_000); !errors.Is(err, ErrState) {
		t.Fatalf("changed price: err = %v, want ErrState", err)
	}
	other := req
	other.PatientID = "patient-2"
	if err := assertSameBooking(base, other, 30, 500_000); !errors.Is(err, ErrState) {
		t.Fatalf("changed patient: err = %v, want ErrState", err)
	}
	unpinned := req
	unpinned.PackageID = ""
	if err := assertSameBooking(base, unpinned, 30, 500_000); !errors.Is(err, ErrState) {
		t.Fatalf("changed package: err = %v, want ErrState", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/health/consultengine -run 'TestResolveBookPrice|TestAssertSameBooking' -count=1
```
Expected: FAIL — `undefined: resolveBookPrice`, `undefined: assertSameBooking`.

- [ ] **Step 3: Add the type and constant**

In `types.go`, add after the `Package` struct:

```go
// PriceSnapshot pins the price a module already charged or escrowed, for a
// session with no published package behind it (an appointment booked before the
// provider priced timed sessions). The module computes it from its own committed
// money row; the engine records that number instead of inventing one.
type PriceSnapshot struct {
	DurationMinutes int
	PriceKobo       int64
}
```

In the constants block add:

```go
	EarlyJoinWindow        = 10 * time.Minute
```

In `BookRequest` add the field (keep every existing field):

```go
	// PackageID is the price point the patient picked. Empty is allowed only
	// when Snapshot is set (legacy appointment pricing).
	PackageID string
	Snapshot  *PriceSnapshot
```

- [ ] **Step 4: Write `booking.go`**

```go
package consultengine

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// resolveBookPrice decides what a session costs. A snapshot wins over the
// package price because the module already moved that money; it must still
// agree with the pinned package's duration. A package that went inactive
// between the picker and the booking is refused — its price is no longer a
// price anyone can buy.
func resolveBookPrice(pkgDuration int, pkgPrice int64, pkgActive bool, snap *PriceSnapshot) (int, int64, error) {
	if snap != nil {
		if snap.DurationMinutes < MinDurationMinutes || snap.DurationMinutes > MaxDurationMinutes {
			return 0, 0, ErrInvalid
		}
		if snap.PriceKobo <= 0 || snap.PriceKobo > 100_000_000 {
			return 0, 0, ErrInvalid
		}
		if pkgDuration > 0 && snap.DurationMinutes != pkgDuration {
			return 0, 0, ErrInvalid
		}
		return snap.DurationMinutes, snap.PriceKobo, nil
	}
	if !pkgActive {
		return 0, 0, ErrInvalid
	}
	return pkgDuration, pkgPrice, nil
}

// resolveBooking validates the request and prices it, loading the pinned
// package when one is named.
func (s *Service) resolveBooking(ctx context.Context, req BookRequest) (int, int64, error) {
	if !validVertical(req.Vertical) || !validMode(req.Mode) {
		return 0, 0, ErrInvalid
	}
	if strings.TrimSpace(req.PatientID) == "" || strings.TrimSpace(req.SourceRef) == "" {
		return 0, 0, ErrInvalid
	}
	if strings.TrimSpace(req.PackageID) == "" && req.Snapshot == nil {
		return 0, 0, ErrInvalid
	}
	if err := s.verifyProviderUser(ctx, req); err != nil {
		return 0, 0, err
	}

	var pkgDuration int
	var pkgPrice int64
	var pkgActive bool
	if strings.TrimSpace(req.PackageID) != "" {
		const pq = `SELECT duration_minutes, price_kobo, active
		            FROM consult_session_packages
		            WHERE id=$1 AND owner_kind=$2 AND owner_id=$3 AND vertical=$4 AND mode=$5`
		err := s.db.QueryRow(ctx, pq, req.PackageID, req.ProviderOwnerKind,
			req.ProviderOwnerID, req.Vertical, req.Mode).
			Scan(&pkgDuration, &pkgPrice, &pkgActive)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, 0, ErrInvalid
		}
		if err != nil {
			return 0, 0, fmt.Errorf("consult: load package: %w", err)
		}
	}
	return resolveBookPrice(pkgDuration, pkgPrice, pkgActive, req.Snapshot)
}

// assertSameBooking proves a conflicting insert is the SAME booking, not a
// second attempt to sell the same appointment at another price or to another
// provider. Any difference is a state conflict; the first row stays canonical.
func assertSameBooking(existing Session, req BookRequest, duration int, price int64) error {
	existingPackage := ""
	if existing.PackageID != nil {
		existingPackage = *existing.PackageID
	}
	same := existing.Vertical == req.Vertical &&
		existing.Mode == req.Mode &&
		existing.PatientID == req.PatientID &&
		existing.ProviderUserID == req.ProviderUserID &&
		existing.ProviderOwnerKind == req.ProviderOwnerKind &&
		existing.ProviderOwnerID == req.ProviderOwnerID &&
		existing.SourceRef == req.SourceRef &&
		existingPackage == req.PackageID &&
		existing.DurationMinutes == duration &&
		existing.PriceKobo == price
	if !same {
		return ErrState
	}
	return nil
}
```

- [ ] **Step 5: Rewrite `Book` on top of the resolver and the conflict path**

Replace the whole `func (s *Service) Book(...)` body in `sessions.go` with:

```go
// Book prices a session, snapshots it, provisions the room and stores the row.
// It is replay-safe per (vertical, source_ref): a concurrent or retried call
// converges on the first row instead of creating a second room, and a retry
// that disagrees on price or participants is a state conflict.
func (s *Service) Book(ctx context.Context, req BookRequest) (Session, error) {
	duration, price, err := s.resolveBooking(ctx, req)
	if err != nil {
		return Session{}, err
	}
	if s.media == nil {
		return Session{}, ErrMediaUnavailable
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
	           ON CONFLICT (vertical, source_ref) DO NOTHING
	           RETURNING ` + sessionColumns
	var hold, pkgID *string
	if strings.TrimSpace(req.BaseHoldID) != "" {
		hold = &req.BaseHoldID
	}
	if strings.TrimSpace(req.PackageID) != "" {
		pkgID = &req.PackageID
	}
	sess, err := scanSession(s.db.QueryRow(ctx, q, id, req.Vertical, req.Mode, req.PatientID,
		req.ProviderOwnerKind, req.ProviderOwnerID, req.ProviderUserID, req.SourceRef,
		pkgID, duration, price, start, ends, warn, room, hold))
	if errors.Is(err, pgx.ErrNoRows) {
		// Another attempt won the unique index. Its room is the live one; the
		// room this attempt just created is empty and must not linger.
		existing, lerr := s.loadBySource(ctx, req.Vertical, req.SourceRef)
		if lerr != nil {
			return Session{}, lerr
		}
		_ = s.media.CloseRoom(ctx, room)
		if aerr := assertSameBooking(existing, req, duration, price); aerr != nil {
			return Session{}, aerr
		}
		return s.view(existing), nil
	}
	if err != nil {
		return Session{}, fmt.Errorf("consult: book session: %w", err)
	}
	s.audited(req.PatientID, req.ProviderUserID, "health.consult.book", sess.ID, nil, map[string]any{
		"vertical": string(req.Vertical), "mode": string(req.Mode),
		"duration_minutes": duration, "price_kobo": price,
	})
	return s.view(sess), nil
}
```

- [ ] **Step 6: Add `EnsureSession` and `CompleteBySource`**

Append to `sessions.go`:

```go
// EnsureSession converges every open of one appointment on a single session.
// The first call creates the room; every retry — either party, any device,
// even after a crash between insert and response — returns the same row.
func (s *Service) EnsureSession(ctx context.Context, req BookRequest) (Session, error) {
	if strings.TrimSpace(req.Vertical) != "" && strings.TrimSpace(req.SourceRef) != "" {
		existing, err := s.loadBySource(ctx, req.Vertical, req.SourceRef)
		if err == nil {
			duration, price, rerr := s.resolveBooking(ctx, req)
			if rerr != nil {
				return Session{}, rerr
			}
			if aerr := assertSameBooking(existing, req, duration, price); aerr != nil {
				return Session{}, aerr
			}
			return s.view(existing), nil
		}
		if !errors.Is(err, ErrNotFound) {
			return Session{}, err
		}
	}
	return s.Book(ctx, req)
}

// CompleteBySource ends the session pinned to a module appointment, if one
// exists. A module calls this from its own completion path. A missing session
// is not an error (pre-Slice-2 appointments have none); a caller outside the
// session gets the uniform not-found fold.
func (s *Service) CompleteBySource(ctx context.Context, vertical Vertical, sourceRef, callerID string) error {
	sess, err := s.loadBySource(ctx, vertical, sourceRef)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if callerID != sess.PatientID && callerID != sess.ProviderUserID {
		return ErrNotFound
	}
	return s.endSession(ctx, sess)
}
```

- [ ] **Step 7: Refuse joins more than ten minutes early**

In `Join`, immediately after the ended/cancelled/past-end check, add:

```go
	// Slice 2 is the first slice that books future sessions. A party who opens
	// the room early gets the lobby, not a token: joining starts the clock and
	// moves the session live, so an hour-early tap would burn the appointment.
	if sess.State == StateScheduled && now.Before(sess.BookedStart.Add(-EarlyJoinWindow)) {
		return Join{}, ErrState
	}
```

- [ ] **Step 8: Widen the extension scanner and add `ListExtensions`**

In `extensions.go`, change the signature:

```go
func scanExtension(row rowScanner) (Extension, error) {
```

Append:

```go
// ListExtensions returns the session's extension requests, newest first, to a
// participant only. Both sides poll this while the warning is up, so a patient
// sees an approval without a manual refresh and a provider sees the request
// that needs a decision.
func (s *Service) ListExtensions(ctx context.Context, sessionID, callerID string) ([]Extension, error) {
	if _, _, err := s.loadForCaller(ctx, sessionID, callerID); err != nil {
		return nil, err
	}
	q := `SELECT ` + extColumns + ` FROM consult_extension_requests
	      WHERE session_id=$1 ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q, sessionID)
	if err != nil {
		return nil, fmt.Errorf("consult: list extensions: %w", err)
	}
	defer rows.Close()
	out := []Extension{}
	for rows.Next() {
		ext, err := scanExtension(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ext)
	}
	return out, rows.Err()
}
```

- [ ] **Step 9: Run the pure tests and the build**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/health/consultengine -run 'TestResolveBookPrice|TestAssertSameBooking|TestScanSession' -count=1
go build ./... && go vet ./...
```
Expected: `ok`; build and vet clean.

- [ ] **Step 10: Append the live-DB tests**

Append to `engine_slice2_live_db_test.go`:

```go
func TestEnsureSessionIsIdempotentOnSourceRef(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	req := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-idem", PackageID: pkg.ID,
	}
	first, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	second, err := f.svc.EnsureSession(context.Background(), req)
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("a retry minted a second session: %s vs %s", second.ID, first.ID)
	}
	var count int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM consult_sessions WHERE vertical='vet' AND source_ref='vet:appt-idem'`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("sessions = %d, want 1", count)
	}
	if len(f.media.ensured) != 1 {
		t.Fatalf("a retry provisioned a second room: %v", f.media.ensured)
	}
}

func TestEnsureSessionRejectsAChangedPrice(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	base := BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-reprice", PackageID: pkg.ID,
	}
	if _, err := f.svc.EnsureSession(context.Background(), base); err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	cheaper := base
	cheaper.PackageID = ""
	cheaper.Snapshot = &PriceSnapshot{DurationMinutes: 30, PriceKobo: 400_000}
	if _, err := f.svc.EnsureSession(context.Background(), cheaper); !errors.Is(err, ErrState) {
		t.Fatalf("reprice: err = %v, want ErrState", err)
	}
}

func TestSnapshotPricedSessionNeedsNoPackage(t *testing.T) {
	f := newEngineFixture(t)
	sess, err := f.svc.EnsureSession(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:legacy-appt",
		Snapshot: &PriceSnapshot{DurationMinutes: 20, PriceKobo: 300_000},
	})
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if sess.PackageID != nil {
		t.Fatalf("legacy session carries a package: %v", *sess.PackageID)
	}
	if sess.DurationMinutes != 20 || sess.PriceKobo != 300_000 {
		t.Fatalf("snapshot = %d min / %d kobo", sess.DurationMinutes, sess.PriceKobo)
	}
}

func TestJoinRefusesMoreThanTenMinutesEarly(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.Book(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-early", PackageID: pkg.ID,
		Start: f.clock.Add(45 * time.Minute),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); !errors.Is(err, ErrState) {
		t.Fatalf("join 45m early: err = %v, want ErrState", err)
	}
	f.clock = f.clock.Add(36 * time.Minute) // 9 minutes before the booked start
	if _, err := f.svc.Join(context.Background(), sess.ID, f.patientID); err != nil {
		t.Fatalf("join inside the lead window: %v", err)
	}
}

func TestCompleteBySourceEndsThePinnedSession(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess, err := f.svc.EnsureSession(context.Background(), BookRequest{
		Vertical: VerticalVet, Mode: ModeVideo, PatientID: f.patientID,
		ProviderOwnerKind: OwnerHealthProvider, ProviderOwnerID: f.providerRow,
		ProviderUserID: f.providerID, SourceRef: "vet:appt-complete", PackageID: pkg.ID,
	})
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if err := f.svc.CompleteBySource(context.Background(), VerticalVet, "vet:appt-complete", f.providerID); err != nil {
		t.Fatalf("complete by source: %v", err)
	}
	got, err := f.svc.Get(context.Background(), sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.State != StateEnded {
		t.Fatalf("state = %q, want ended", got.State)
	}
	if err := f.svc.CompleteBySource(context.Background(), VerticalVet, "vet:no-session", f.providerID); err != nil {
		t.Fatalf("a missing session must be a no-op, got %v", err)
	}
	if err := f.svc.CompleteBySource(context.Background(), VerticalVet, "vet:appt-complete", uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger complete: err = %v, want ErrNotFound", err)
	}
}

func TestListExtensionsIsParticipantScopedAndNewestFirst(t *testing.T) {
	f := newEngineFixture(t)
	pkg := f.publishVetVideo(t, 30, 500_000)
	sess := f.bookVetVideo(t, pkg)
	ctx := context.Background()

	first, err := f.svc.RequestExtension(ctx, sess.ID, f.patientID, 5)
	if err != nil {
		t.Fatalf("first request: %v", err)
	}
	if _, err := f.svc.DecideExtension(ctx, sess.ID, first.ID, f.providerID, false, "not now"); err != nil {
		t.Fatalf("decline: %v", err)
	}
	f.clock = f.clock.Add(time.Minute) // distinct created_at for the ordering
	second, err := f.svc.RequestExtension(ctx, sess.ID, f.patientID, 10)
	if err != nil {
		t.Fatalf("second request: %v", err)
	}

	list, err := f.svc.ListExtensions(ctx, sess.ID, f.patientID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 || list[0].ID != second.ID || list[1].ID != first.ID {
		t.Fatalf("order = %+v, want newest first", list)
	}
	if _, err := f.svc.ListExtensions(ctx, sess.ID, f.providerID); err != nil {
		t.Fatalf("provider list: %v", err)
	}
	if _, err := f.svc.ListExtensions(ctx, sess.ID, uuid.NewString()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger list: err = %v, want ErrNotFound", err)
	}
}
```

Add `"time"` to that test file's imports.

- [ ] **Step 11: Run the live tests**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/health/consultengine -count=1 -v
```
Expected: every test PASS, including the Slice 1 suite (the `Book` rewrite must not change any Slice 1 assertion).

- [ ] **Step 12: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/consultengine/booking.go \
        backend/internal/health/consultengine/booking_test.go \
        backend/internal/health/consultengine/types.go \
        backend/internal/health/consultengine/sessions.go \
        backend/internal/health/consultengine/extensions.go \
        backend/internal/health/consultengine/engine_slice2_live_db_test.go
git commit -m "feat(consult): idempotent sessions, price snapshots, early-join guard, extension list"
```

### Task 4: Consult HTTP surface — public package read, participant extension list

**Files:**
- Modify: `backend/internal/app/consult_routes.go` (`consultAPI`, `consultHandler`, `registerConsultHandlers`, `RegisterConsult`)
- Test: `backend/internal/app/consult_routes_test.go`

**Interfaces:**
- Consumes: `consultengine.Service.GetPackage(ctx, id) (Package, error)` and `ListExtensions(ctx, sessionID, callerID) ([]Extension, error)` (Tasks 2 and 3).
- Produces:
  - `GET /api/v1/consult/packages/:id` → `{"success":true,"package":Package}`, public, no caller identity.
  - `GET /api/v1/consult/sessions/:id/extensions` → `{"success":true,"extensions":[]Extension}`, requires `user_id`.
  - Interface methods consumed by the fake in `consult_routes_test.go`:
    `GetPackage(ctx context.Context, id string) (consultengine.Package, error)`,
    `ListExtensions(ctx context.Context, sessionID, callerID string) ([]consultengine.Extension, error)`.

- [ ] **Step 1: Write the failing handler tests**

In `backend/internal/app/consult_routes_test.go`, extend `fakeConsultAPI` with the two new methods and observation fields. Add these fields to the struct:

```go
	lastPackage string
	lastSession string
	packageErr  error
	extListErr  error
```

Add these methods below `ListPackages`:

```go
func (f *fakeConsultAPI) GetPackage(_ context.Context, id string) (consultengine.Package, error) {
	f.lastPackage = id
	if f.packageErr != nil {
		return consultengine.Package{}, f.packageErr
	}
	return consultengine.Package{
		ID: id, Vertical: consultengine.VerticalTelemedicine, Mode: consultengine.ModeVideo,
		DurationMinutes: 30, PriceKobo: 500_000, Active: true,
	}, nil
}
func (f *fakeConsultAPI) ListExtensions(_ context.Context, sessionID, callerID string) ([]consultengine.Extension, error) {
	f.lastCaller, f.lastSession = callerID, sessionID
	if f.extListErr != nil {
		return nil, f.extListErr
	}
	return []consultengine.Extension{{ID: "ext-1", AddedMinutes: 10, Status: consultengine.ExtPending}}, nil
}
```

Mount the public package read in `consultTestRouter`, directly under the existing public list route:

```go
	r.GET("/api/v1/consult/packages/:id", (&consultHandler{svc: api}).getPackage) // public
```

Append the tests:

```go
func TestConsultPackageGetIsPublic(t *testing.T) {
	id := uuid.NewString()
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/packages/"+id, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("get package: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Success bool                  `json:"success"`
		Package consultengine.Package `json:"package"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Success || body.Package.ID != id {
		t.Fatalf("body = %+v", body)
	}
	if f.lastPackage != id {
		t.Fatalf("engine got %q, want %q", f.lastPackage, id)
	}
}

func TestConsultPackageGetFoldsInactiveTo404(t *testing.T) {
	f := &fakeConsultAPI{packageErr: consultengine.ErrNotFound}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/packages/"+uuid.NewString(), "", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("inactive package: %d, want 404 (%s)", w.Code, w.Body.String())
	}
}

func TestConsultListExtensionsUsesTheAuthenticatedCaller(t *testing.T) {
	sessionID := uuid.NewString()
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/sessions/"+sessionID+"/extensions", "user-1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("list extensions: %d %s", w.Code, w.Body.String())
	}
	if f.lastCaller != "user-1" || f.lastSession != sessionID {
		t.Fatalf("caller/session = %q/%q", f.lastCaller, f.lastSession)
	}
	var body struct {
		Success    bool                      `json:"success"`
		Extensions []consultengine.Extension `json:"extensions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Success || len(body.Extensions) != 1 || body.Extensions[0].ID != "ext-1" {
		t.Fatalf("body = %+v", body)
	}
}

func TestConsultListExtensionsRejectsMalformedAndForeignSessions(t *testing.T) {
	f := &fakeConsultAPI{extListErr: consultengine.ErrNotFound}
	r := consultTestRouter(f)

	w := doJSON(r, http.MethodGet, "/api/v1/consult/sessions/not-a-uuid/extensions", "user-1", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("malformed id: %d, want 404", w.Code)
	}
	if f.lastCaller != "" {
		t.Fatalf("engine called with a malformed id: caller = %q", f.lastCaller)
	}

	w = doJSON(r, http.MethodGet, "/api/v1/consult/sessions/"+uuid.NewString()+"/extensions", "user-1", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("foreign session: %d, want 404 (%s)", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/app -run 'TestConsultPackageGet|TestConsultListExtensions' -count=1
```
Expected: FAIL — `f.getPackage undefined` (`*consultHandler` has no method `getPackage`) and `cannot use f (variable of type *fakeConsultAPI) as consultAPI value: missing method GetPackage`.

- [ ] **Step 3: Extend the interface and handlers**

In `backend/internal/app/consult_routes.go`, add two methods to `consultAPI` after `ListPackages`:

```go
	GetPackage(ctx context.Context, id string) (consultengine.Package, error)
```

and after `ListMessages`:

```go
	ListExtensions(ctx context.Context, sessionID, callerID string) ([]consultengine.Extension, error)
```

Add the handlers directly below `listPackages`:

```go
func (h *consultHandler) getPackage(c *gin.Context) {
	id, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	pkg, err := h.svc.GetPackage(c.Request.Context(), id)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "package": pkg})
}

// listExtensions is participant-scoped inside the engine: a stranger's session
// id answers ErrNotFound, never an empty list that would confirm existence.
func (h *consultHandler) listExtensions(c *gin.Context) {
	caller, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	sessionID, ok := consultPathID(c, "id")
	if !ok {
		return
	}
	items, err := h.svc.ListExtensions(c.Request.Context(), sessionID, caller)
	if err != nil {
		consultErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "extensions": items})
}
```

- [ ] **Step 4: Mount the routes**

In `registerConsultHandlers`, add below the `extensions/:ext/pay` line:

```go
	g.GET("/sessions/:id/extensions", h.listExtensions)
```

In `RegisterConsult`, add below `pub.GET("/packages", h.listPackages)`:

```go
	pub.GET("/packages/:id", h.getPackage)
```

- [ ] **Step 5: Run the handler tests**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/app -run 'TestConsult' -count=1 -v
```
Expected: every `TestConsult*` PASS — the new four plus every Slice 1 handler test.

- [ ] **Step 6: Build and vet**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go build ./... && go vet ./...
```
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/app/consult_routes.go backend/internal/app/consult_routes_test.go
git commit -m "feat(consult): public package read and participant extension list over HTTP"
```

### Task 5: Telemedicine — package picker data, pinned booking, session open, completion hook

**Files:**
- Create: `backend/internal/telemedicine/consult.go`
- Create: `backend/internal/telemedicine/consult_test.go`
- Create: `backend/internal/telemedicine/consult_live_db_test.go`
- Modify: `backend/internal/telemedicine/model.go` (`DoctorPackage`, `Doctor.Packages`, `BookAppointmentRequest.PackageID`)
- Modify: `backend/internal/telemedicine/service.go` (`Service.consult`, `GetDoctor`, `BookAppointment`, `CompleteAppointment`)
- Modify: `backend/internal/telemedicine/handler.go` (`BookAppointment` error map, `OpenConsultSession`)
- Modify: `backend/internal/app/finance_routes.go` (one route)

**Interfaces:**
- Consumes: `consultengine.EnsureSession(ctx, BookRequest) (Session, error)`, `consultengine.CompleteBySource(ctx, Vertical, sourceRef, callerID) error`, `consultengine.PriceSnapshot` (Task 3); `appointments.consult_package_id/consult_mode/consult_duration_minutes` (Task 1).
- Produces:
  - `telemedicine.ConsultEngine` interface; `(*Service).WithConsultEngine(ConsultEngine) *Service`.
  - `(*Service).OpenConsultSession(ctx, appointmentID, callerID string) (consultengine.Session, error)`.
  - `GET /api/v1/telemedicine/doctors/:id` now carries `packages: [{id, mode, duration_minutes, price_kobo, booking}]`.
  - `POST /api/v1/telemedicine/appointments` accepts `package_id`; `POST /api/v1/telemedicine/appointments/:id/consult-session` returns `{"data": Session}`.
  - Sentinels: `ErrPackageInvalid`, `ErrPackageRequired`, `ErrConsultModeInvalid`, `ErrAppointmentNotFound`, `ErrSessionNotOpenable`, `ErrConsultUnavailable`.
  - Source ref: **`"appointment:" + appointmentID`** — Task 7's vet code and Task 8's mobile client must use the same spelling.

- [ ] **Step 1: Write the failing pure tests**

Create `backend/internal/telemedicine/consult_test.go`:

```go
package telemedicine

import (
	"errors"
	"testing"

	"spotlight/backend/internal/health/consultengine"
)

func TestNormalizeConsultMode(t *testing.T) {
	cases := map[string]consultengine.Mode{
		"":      consultengine.ModeVideo,
		"video": consultengine.ModeVideo,
		"VIDEO": consultengine.ModeVideo,
		"audio": consultengine.ModeVoice,
		"voice": consultengine.ModeVoice,
		"chat":  consultengine.ModeChat,
	}
	for in, want := range cases {
		got, err := normalizeConsultMode(in)
		if err != nil || got != want {
			t.Fatalf("%q -> %q/%v, want %q", in, got, err, want)
		}
	}
	if _, err := normalizeConsultMode("in_person"); !errors.Is(err, ErrConsultModeInvalid) {
		t.Fatalf("in_person: err = %v, want ErrConsultModeInvalid", err)
	}
}

func TestModuleConsultTypeSpellsVoiceAsAudio(t *testing.T) {
	if got := moduleConsultType(consultengine.ModeVoice); got != "audio" {
		t.Fatalf("voice -> %q, want audio", got)
	}
	if got := moduleConsultType(consultengine.ModeChat); got != "chat" {
		t.Fatalf("chat -> %q", got)
	}
}

// The package price replaces the doctor's consult fee as the priced amount;
// the platform booking fee still rides on top, so the escrow, the receipt and
// the session snapshot all agree.
func TestPackagePriceDrivesTheBookingQuote(t *testing.T) {
	svc := (&Service{}).WithPlatformFeeBp(PlatformFeeBp)
	q := svc.quote(700_000)
	if q.ConsultFeeKobo != 700_000 || q.PlatformFeeKobo != 35_000 || q.TotalKobo != 735_000 {
		t.Fatalf("quote = %+v", q)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/telemedicine -run 'TestNormalizeConsultMode|TestModuleConsultType|TestPackagePriceDrives' -count=1
```
Expected: FAIL — `undefined: normalizeConsultMode`, `undefined: moduleConsultType`, `undefined: ErrConsultModeInvalid`.

- [ ] **Step 3: Add the model types**

In `backend/internal/telemedicine/model.go`, add above `Doctor`:

```go
// DoctorPackage is one priced consultation option a doctor sells. Booking is
// the server quote for that price point, so the picker renders our number and
// never computes a platform fee of its own (ADR-044).
type DoctorPackage struct {
	ID              string       `json:"id"`
	Mode            string       `json:"mode"`
	DurationMinutes int          `json:"duration_minutes"`
	PriceKobo       int64        `json:"price_kobo"`
	Booking         BookingQuote `json:"booking"`
}
```

Add to `Doctor`, below `Booking`:

```go
	// Packages are the timed price points patients can buy. Empty means the
	// doctor has not adopted timed consults and books at the legacy fee.
	Packages []DoctorPackage `json:"packages,omitempty"`
```

Add to `BookAppointmentRequest`, after `ExpectedTotalKobo`:

```go
	// PackageID pins the consultation to one of this doctor's published
	// packages. Empty is the legacy path: the doctor's consultation fee prices
	// the booking and the session starts from a price snapshot.
	PackageID string `json:"package_id"`
```

- [ ] **Step 4: Write `consult.go`**

```go
package telemedicine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/health/consultengine"
)

// ConsultEngine is the slice of the shared consult engine this module needs:
// opening the one session pinned to an appointment, and ending it when the
// appointment completes. An interface keeps the module free of the engine's
// concrete wiring.
type ConsultEngine interface {
	EnsureSession(ctx context.Context, req consultengine.BookRequest) (consultengine.Session, error)
	CompleteBySource(ctx context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error
}

// WithConsultEngine wires the shared engine. Nil is valid: the module keeps
// its legacy behaviour and OpenConsultSession answers 503.
func (s *Service) WithConsultEngine(c ConsultEngine) *Service {
	s.consult = c
	return s
}

var (
	// ErrPackageInvalid means the chosen package is not this doctor's, is not
	// a telemedicine package, or is no longer active.
	ErrPackageInvalid = errors.New("telemedicine: consultation package is not available")
	// ErrPackageRequired means the doctor sells timed sessions for the requested
	// mode, so the legacy fee is no longer a valid price.
	ErrPackageRequired = errors.New("telemedicine: choose a consultation package")
	// ErrConsultModeInvalid means the appointment type is not chat/voice/video.
	ErrConsultModeInvalid = errors.New("telemedicine: unknown consultation type")
	// ErrAppointmentNotFound also covers a caller who is neither the patient nor
	// the assigned doctor: existence is never confirmed to a stranger.
	ErrAppointmentNotFound = errors.New("telemedicine: appointment not found")
	// ErrSessionNotOpenable means the appointment is cancelled or completed.
	ErrSessionNotOpenable = errors.New("telemedicine: appointment is not open for a consultation")
	// ErrConsultUnavailable means no media engine is wired.
	ErrConsultUnavailable = errors.New("telemedicine: consult media is not available")
)

// normalizeConsultMode maps the module's consultation_type onto the engine's
// three modes. Telemedicine has always spelled a voice consult "audio".
func normalizeConsultMode(consultationType string) (consultengine.Mode, error) {
	switch strings.ToLower(strings.TrimSpace(consultationType)) {
	case "", "video":
		return consultengine.ModeVideo, nil
	case "audio", "voice":
		return consultengine.ModeVoice, nil
	case "chat":
		return consultengine.ModeChat, nil
	}
	return "", ErrConsultModeInvalid
}

// moduleConsultType renders an engine mode in the module's spelling, so the
// existing screens keep receiving "audio" for a voice consult.
func moduleConsultType(m consultengine.Mode) string {
	if m == consultengine.ModeVoice {
		return "audio"
	}
	return string(m)
}

// consultPackage is the priced option a booking pinned.
type consultPackage struct {
	ID              string
	Mode            consultengine.Mode
	DurationMinutes int
	PriceKobo       int64
}

// legacyConsultMinutes is the duration an appointment without a package runs,
// unchanged from the module's pre-LiveKit behaviour.
const legacyConsultMinutes = 20

// resolveConsultPackage validates the picker's choice. With a package, the
// package's mode and price win — the patient explicitly chose that price
// point. Without one, the legacy path is allowed only when the doctor has not
// published a package for the requested mode.
func (s *Service) resolveConsultPackage(ctx context.Context, doctorUserID, packageID, consultationType string) (consultPackage, bool, error) {
	if strings.TrimSpace(packageID) == "" {
		mode, err := normalizeConsultMode(consultationType)
		if err != nil {
			return consultPackage{}, false, err
		}
		const q = `SELECT EXISTS (
			SELECT 1 FROM consult_session_packages
			WHERE owner_kind='doctor' AND owner_id=$1::uuid
			  AND vertical='telemedicine' AND mode=$2 AND active=TRUE)`
		var sells bool
		if err := s.db.QueryRow(ctx, q, doctorUserID, mode).Scan(&sells); err != nil {
			return consultPackage{}, false, fmt.Errorf("telemedicine: check packages: %w", err)
		}
		if sells {
			return consultPackage{}, false, ErrPackageRequired
		}
		return consultPackage{Mode: mode, DurationMinutes: legacyConsultMinutes}, false, nil
	}

	if _, err := uuid.Parse(packageID); err != nil {
		return consultPackage{}, false, ErrPackageInvalid
	}
	var pkg consultPackage
	var mode string
	const q = `SELECT id::text, mode, duration_minutes, price_kobo
	           FROM consult_session_packages
	           WHERE id=$1::uuid AND owner_kind='doctor' AND owner_id=$2::uuid
	             AND vertical='telemedicine' AND active=TRUE`
	err := s.db.QueryRow(ctx, q, packageID, doctorUserID).
		Scan(&pkg.ID, &mode, &pkg.DurationMinutes, &pkg.PriceKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return consultPackage{}, false, ErrPackageInvalid
	}
	if err != nil {
		return consultPackage{}, false, fmt.Errorf("telemedicine: load package: %w", err)
	}
	pkg.Mode = consultengine.Mode(mode)
	return pkg, true, nil
}

// listDoctorPackages returns the doctor's active telemedicine price points,
// each with the same quote the booking endpoint will escrow.
func (s *Service) listDoctorPackages(ctx context.Context, doctorUserID string) ([]DoctorPackage, error) {
	const q = `SELECT id::text, mode, duration_minutes, price_kobo
	           FROM consult_session_packages
	           WHERE owner_kind='doctor' AND owner_id=$1::uuid
	             AND vertical='telemedicine' AND active=TRUE
	           ORDER BY mode, price_kobo, duration_minutes`
	rows, err := s.db.Query(ctx, q, doctorUserID)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: list packages: %w", err)
	}
	defer rows.Close()
	out := []DoctorPackage{}
	for rows.Next() {
		var p DoctorPackage
		if err := rows.Scan(&p.ID, &p.Mode, &p.DurationMinutes, &p.PriceKobo); err != nil {
			return nil, err
		}
		p.Booking = s.quote(p.PriceKobo)
		out = append(out, p)
	}
	return out, rows.Err()
}

// OpenConsultSession returns the single session pinned to an appointment,
// creating it on first open. Both participants may open it; a stranger gets
// the same not-found as a missing appointment. The request always carries a
// price snapshot from the committed appointment row: the patient paid that
// number, even if the provider edited the package price afterwards.
func (s *Service) OpenConsultSession(ctx context.Context, appointmentID, callerID string) (consultengine.Session, error) {
	if s.consult == nil {
		return consultengine.Session{}, ErrConsultUnavailable
	}
	if _, err := uuid.Parse(appointmentID); err != nil {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	const q = `
		SELECT a.patient_id::text, a.status, a.scheduled_at,
		       d.user_id::text, COALESCE(a.settlement_id::text, ''),
		       COALESCE(a.consult_package_id::text, ''),
		       COALESCE(a.consult_mode, 'video'),
		       a.fee_kobo,
		       COALESCE(a.consult_duration_minutes, 20)
		FROM appointments a
		JOIN doctors d ON d.id = a.doctor_id
		WHERE a.id = $1::uuid`
	var patientID, status, doctorUserID, holdID, packageID, mode string
	var scheduledAt time.Time
	var feeKobo int64
	var durationMinutes int
	err := s.db.QueryRow(ctx, q, appointmentID).Scan(&patientID, &status, &scheduledAt,
		&doctorUserID, &holdID, &packageID, &mode, &feeKobo, &durationMinutes)
	if errors.Is(err, pgx.ErrNoRows) {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if err != nil {
		return consultengine.Session{}, fmt.Errorf("telemedicine: load appointment: %w", err)
	}
	if callerID != patientID && callerID != doctorUserID {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if status != string(ApptBooked) && status != string(ApptConfirmed) {
		return consultengine.Session{}, ErrSessionNotOpenable
	}
	// An appointment opened more than five minutes late starts now, so the
	// patient still receives the full duration they paid for. The engine itself
	// refuses a start older than five minutes.
	start := scheduledAt
	if time.Now().After(scheduledAt.Add(5 * time.Minute)) {
		start = time.Time{}
	}
	return s.consult.EnsureSession(ctx, consultengine.BookRequest{
		Vertical:          consultengine.VerticalTelemedicine,
		Mode:              consultengine.Mode(mode),
		PatientID:         patientID,
		ProviderOwnerKind: consultengine.OwnerDoctor,
		ProviderOwnerID:   doctorUserID,
		ProviderUserID:    doctorUserID,
		SourceRef:         "appointment:" + appointmentID,
		PackageID:         packageID,
		BaseHoldID:        holdID,
		Start:             start,
		Snapshot: &consultengine.PriceSnapshot{
			DurationMinutes: durationMinutes,
			PriceKobo:       feeKobo,
		},
	})
}
```

- [ ] **Step 5: Add the service field and attach packages in `GetDoctor`**

In `service.go`, add to the `Service` struct after `notify`:

```go
	// consult is the shared LiveKit consult engine. Nil means timed sessions are
	// not wired; the legacy booking path is untouched.
	consult ConsultEngine
```

Replace the tail of `GetDoctor`:

```go
	if len(doctors) == 0 {
		return nil, ErrDoctorNotFound
	}
	doctor := &doctors[0]
	packages, err := s.listDoctorPackages(ctx, doctor.UserID)
	if err != nil {
		return nil, err
	}
	doctor.Packages = packages
	return doctor, nil
}
```

- [ ] **Step 6: Pin the package in `BookAppointment`**

Replace the quote block (the comment plus `quote := s.quote(doctor.ConsultFeeKobo)`) with:

```go
	// Price the booking SERVER-SIDE (ADR-044). A picked package supplies both
	// the mode and the priced amount; the platform booking fee still rides on
	// top. Without a package the doctor's legacy fee prices the booking, and
	// resolveConsultPackage has already refused that path if this doctor sells
	// a timed package for the requested mode.
	pkg, hasPkg, err := s.resolveConsultPackage(ctx, doctor.UserID, req.PackageID, req.ConsultationType)
	if err != nil {
		return nil, err
	}
	quote := s.quote(doctor.ConsultFeeKobo)
	if hasPkg {
		quote = s.quote(pkg.PriceKobo)
	}
```

Replace the consultation-type block:

```go
	ct := req.ConsultationType
	if ct == "" {
		ct = "video"
	}
```

with:

```go
	ct := req.ConsultationType
	if hasPkg {
		ct = moduleConsultType(pkg.Mode)
	}
	if ct == "" {
		ct = "video"
	}
	mode := string(pkg.Mode)
	var pkgID *string
	if hasPkg {
		pkgID = &pkg.ID
	}
```

Replace the appointment INSERT with:

```go
	const q = `
		INSERT INTO appointments
		    (id, patient_id, doctor_id, doctor_name, doctor_specialty, consultation_type,
		     scheduled_at, status, notes, fee_kobo, platform_fee_kobo, total_kobo,
		     idempotency_key, settlement_id, consult_package_id, consult_mode,
		     consult_duration_minutes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'booked',$8,$9,$10,$11,$12,$13,$14,$15,$16)`
	if _, err := s.db.Exec(ctx, q,
		appt.ID, appt.PatientID, appt.DoctorID, appt.DoctorName, appt.DoctorSpecialty,
		appt.ConsultationType, appt.ScheduledAt, appt.Notes,
		appt.FeeKobo, appt.PlatformFeeKobo, appt.TotalKobo,
		appt.IdempotencyKey, appt.SettlementID, pkgID, mode, pkg.DurationMinutes,
	); err != nil {
		return nil, fmt.Errorf("telemedicine: insert appointment: %w", err)
	}
```

The `appt.FeeKobo` already comes from `quote.ConsultFeeKobo`, so a pinned booking records the package price exactly.

- [ ] **Step 7: End the consult when the appointment completes**

Replace the tail of `CompleteAppointment`:

```go
	_, err := s.db.Exec(ctx, `UPDATE appointments SET status='completed' WHERE id=$1`, appointmentID)
	return err
}
```

with:

```go
	if _, err := s.db.Exec(ctx, `UPDATE appointments SET status='completed' WHERE id=$1`, appointmentID); err != nil {
		return err
	}
	// The money has moved; ending the pinned session is best-effort. The
	// sweeper still ends it at ends_at, so an engine or media hiccup must not
	// fail an appointment that is already settled.
	if s.consult != nil {
		if cerr := s.consult.CompleteBySource(ctx, consultengine.VerticalTelemedicine,
			"appointment:"+appointmentID, doctorUserID); cerr != nil {
			fmt.Printf("[telemedicine] complete consult session %s: %v\n", appointmentID, cerr)
		}
	}
	return nil
}
```

Add the import `"spotlight/backend/internal/health/consultengine"` to `service.go`.

- [ ] **Step 8: Map the new refusals and add the handler**

In `handler.go`, add `"spotlight/backend/internal/health/consultengine"` to the imports.

In `BookAppointment`, extend the error switch before the `default`:

```go
		case errors.Is(err, ErrPackageRequired), errors.Is(err, ErrPackageInvalid),
			errors.Is(err, ErrConsultModeInvalid):
			c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, err)})
			return
```

Append the handler below `CompleteAppointment`:

```go
// OpenConsultSession starts (or returns) the LiveKit session pinned to this
// appointment. Both participants may call it; a stranger gets 404 so existence
// is never confirmed.
func (h *Handler) OpenConsultSession(c *gin.Context) {
	userID := ginutil.UserID(c)
	sess, err := h.svc.OpenConsultSession(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrAppointmentNotFound):
			c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		case errors.Is(err, ErrSessionNotOpenable):
			c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
		case errors.Is(err, ErrConsultUnavailable),
			errors.Is(err, consultengine.ErrMediaUnavailable),
			errors.Is(err, consultengine.ErrEscrowUnavailable):
			c.JSON(http.StatusServiceUnavailable, gin.H{keyError: httperr.Msg(c, http.StatusServiceUnavailable, err)})
		case errors.Is(err, consultengine.ErrInvalid), errors.Is(err, consultengine.ErrState):
			c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}
```

- [ ] **Step 9: Mount the route**

In `backend/internal/app/finance_routes.go`, inside the `v1Tele` block, add below the existing `POST /appointments/:id/complete` line:

```go
		v1Tele.POST("/appointments/:id/consult-session", telemedHandler.OpenConsultSession)
```

- [ ] **Step 10: Run the pure tests and build**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/telemedicine -run 'TestNormalizeConsultMode|TestModuleConsultType|TestPackagePriceDrives' -count=1 -v
go build ./... && go vet ./...
```
Expected: three PASS, then no output and exit 0.

- [ ] **Step 11: Write the live tests**

Create `backend/internal/telemedicine/consult_live_db_test.go`:

```go
package telemedicine_test

// LIVE-DB coverage for the Slice 2 telemedicine path. Skips unless
// TEST_DATABASE_URL is set:
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/telemedicine -run TestLiveDB_Consult -v

import (
	"context"
	"errors"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/health/consultengine"
	"spotlight/backend/internal/telemedicine"
)

type fakeConsultEngine struct {
	requests    []consultengine.BookRequest
	completed   []string
	completeErr error
}

func (f *fakeConsultEngine) EnsureSession(_ context.Context, req consultengine.BookRequest) (consultengine.Session, error) {
	f.requests = append(f.requests, req)
	return consultengine.Session{ID: "sess-1"}, nil
}

func (f *fakeConsultEngine) CompleteBySource(_ context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error {
	f.completed = append(f.completed, string(vertical)+"|"+sourceRef+"|"+callerID)
	return f.completeErr
}

func seedPackage(t *testing.T, ctx context.Context, pool *pgxpool.Pool, doctorUserID, mode string, minutes int, priceKobo int64) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO consult_session_packages
		(id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active)
		VALUES ($1::uuid,'doctor',$2::uuid,'telemedicine',$3,$4,$5,TRUE)`,
		id, doctorUserID, mode, minutes, priceKobo); err != nil {
		t.Fatalf("seed package: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM consult_session_packages WHERE id=$1::uuid`, id)
	})
	return id
}

func testTelemedService(t *testing.T, pool *pgxpool.Pool) *telemedicine.Service {
	t.Helper()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	return telemedicine.NewService(pool, settlement.NewService(pool, led)).
		WithTiers(tiers.NewService(pool)).
		WithPlatformFeeBp(telemedicine.PlatformFeeBp)
}

func TestLiveDB_ConsultPackageIsPricedAndPinnedAtBooking(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	pkgID := seedPackage(t, ctx, pool, doctorUserID, "video", 30, 700_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "video",
		PackageID:        pkgID,
		ExpectedTotalKobo: 735_000,
		IdempotencyKey:   "pkg-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	if appt.FeeKobo != 700_000 || appt.PlatformFeeKobo != 35_000 || appt.TotalKobo != 735_000 {
		t.Fatalf("prices = %+v, want 700000/35000/735000", appt)
	}

	var pinnedPkg, mode string
	var minutes int
	if err := pool.QueryRow(ctx, `SELECT consult_package_id::text, consult_mode, consult_duration_minutes
		FROM appointments WHERE id=$1::uuid`, appt.ID).Scan(&pinnedPkg, &mode, &minutes); err != nil {
		t.Fatalf("read pin: %v", err)
	}
	if pinnedPkg != pkgID || mode != "video" || minutes != 30 {
		t.Fatalf("pin = %s/%s/%d, want %s/video/30", pinnedPkg, mode, minutes, pkgID)
	}

	doc, err := svc.GetDoctor(ctx, doctorID)
	if err != nil {
		t.Fatalf("get doctor: %v", err)
	}
	if len(doc.Packages) != 1 || doc.Packages[0].ID != pkgID {
		t.Fatalf("packages = %+v", doc.Packages)
	}
	if doc.Packages[0].Booking.TotalKobo != 735_000 {
		t.Fatalf("package quote = %+v", doc.Packages[0].Booking)
	}
}

func TestLiveDB_ConsultRequiresAPackageOnceTheDoctorSellsOne(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	svc := testTelemedService(t, pool)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	seedPackage(t, ctx, pool, doctorUserID, "video", 30, 700_000)

	_, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "video",
		IdempotencyKey:   "nopkg-" + uuid.NewString(),
	})
	if !errors.Is(err, telemedicine.ErrPackageRequired) {
		t.Fatalf("video without a package: err = %v, want ErrPackageRequired", err)
	}

	// A chat booking is untouched: the doctor sells no chat package.
	if _, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(74 * time.Hour).Truncate(time.Second),
		ConsultationType: "chat",
		IdempotencyKey:   "chat-" + uuid.NewString(),
	}); err != nil {
		t.Fatalf("chat legacy booking: %v", err)
	}

	_, err = svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(76 * time.Hour).Truncate(time.Second),
		ConsultationType: "video",
		PackageID:        uuid.NewString(),
		IdempotencyKey:   "foreign-" + uuid.NewString(),
	})
	if !errors.Is(err, telemedicine.ErrPackageInvalid) {
		t.Fatalf("unknown package: err = %v, want ErrPackageInvalid", err)
	}
}

func TestLiveDB_OpenConsultSessionPinsThePaidSnapshot(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := testTelemedService(t, pool)
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	pkgID := seedPackage(t, ctx, pool, doctorUserID, "video", 30, 700_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "video",
		PackageID:        pkgID,
		ExpectedTotalKobo: 735_000,
		IdempotencyKey:   "open-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	engine := &fakeConsultEngine{}
	svc = svc.WithConsultEngine(engine)
	if _, err := svc.OpenConsultSession(ctx, appt.ID, patientID); err != nil {
		t.Fatalf("open as patient: %v", err)
	}
	if _, err := svc.OpenConsultSession(ctx, appt.ID, doctorUserID); err != nil {
		t.Fatalf("open as doctor: %v", err)
	}
	if len(engine.requests) != 2 {
		t.Fatalf("engine calls = %d", len(engine.requests))
	}
	req := engine.requests[0]
	if req.Vertical != consultengine.VerticalTelemedicine || req.Mode != consultengine.ModeVideo {
		t.Fatalf("vertical/mode = %q/%q", req.Vertical, req.Mode)
	}
	if req.SourceRef != "appointment:"+appt.ID {
		t.Fatalf("source ref = %q", req.SourceRef)
	}
	if req.ProviderOwnerKind != consultengine.OwnerDoctor ||
		req.ProviderOwnerID != doctorUserID || req.ProviderUserID != doctorUserID {
		t.Fatalf("provider = %q/%q/%q", req.ProviderOwnerKind, req.ProviderOwnerID, req.ProviderUserID)
	}
	if req.PackageID != pkgID || req.BaseHoldID != appt.SettlementID {
		t.Fatalf("package/hold = %q/%q", req.PackageID, req.BaseHoldID)
	}
	if req.Snapshot == nil || req.Snapshot.DurationMinutes != 30 || req.Snapshot.PriceKobo != 700_000 {
		t.Fatalf("snapshot = %+v", req.Snapshot)
	}
	if !req.Start.Equal(appt.ScheduledAt) {
		t.Fatalf("start = %v, want %v", req.Start, appt.ScheduledAt)
	}

	if _, err := svc.OpenConsultSession(ctx, appt.ID, uuid.NewString()); !errors.Is(err, telemedicine.ErrAppointmentNotFound) {
		t.Fatalf("stranger: err = %v, want ErrAppointmentNotFound", err)
	}
}

func TestLiveDB_OpenConsultSessionFallsBackToTheLegacySnapshot(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := testTelemedService(t, pool)
	doctorID, _, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "audio",
		IdempotencyKey:   "legacy-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	engine := &fakeConsultEngine{}
	if _, err := svc.WithConsultEngine(engine).OpenConsultSession(ctx, appt.ID, patientID); err != nil {
		t.Fatalf("open: %v", err)
	}
	req := engine.requests[0]
	if req.Mode != consultengine.ModeVoice || req.PackageID != "" {
		t.Fatalf("mode/package = %q/%q", req.Mode, req.PackageID)
	}
	if req.Snapshot == nil || req.Snapshot.DurationMinutes != 20 || req.Snapshot.PriceKobo != 500_000 {
		t.Fatalf("snapshot = %+v", req.Snapshot)
	}
}

func TestLiveDB_CompleteAppointmentEndsTheConsultBestEffort(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := testTelemedService(t, pool)
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)

	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:         doctorID,
		ScheduledAt:      time.Now().Add(72 * time.Hour).Truncate(time.Second),
		ConsultationType: "chat",
		IdempotencyKey:   "complete-" + uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}

	engine := &fakeConsultEngine{completeErr: errors.New("sfu unreachable")}
	if err := svc.WithConsultEngine(engine).CompleteAppointment(ctx, appt.ID, doctorUserID); err != nil {
		t.Fatalf("completion must not fail on an engine error: %v", err)
	}
	want := "telemedicine|appointment:" + appt.ID + "|" + doctorUserID
	if len(engine.completed) != 1 || engine.completed[0] != want {
		t.Fatalf("completed = %v, want [%s]", engine.completed, want)
	}
}
```

- [ ] **Step 12: Run the live tests**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/telemedicine -run 'TestLiveDB_Consult|TestLiveDB_OpenConsult|TestLiveDB_CompleteAppointmentEnds' -count=1 -v
```
Expected: five PASS. If the package requires a migration, re-run Task 1 Step 4 first (`supabase migration up --include-all`).

- [ ] **Step 13: Run the whole module suite**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/telemedicine ./internal/app -count=1
```
Expected: all PASS — the legacy fee, replay, tier-gate and handler suites must still pass unchanged.

- [ ] **Step 14: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/telemedicine/consult.go \
        backend/internal/telemedicine/consult_test.go \
        backend/internal/telemedicine/consult_live_db_test.go \
        backend/internal/telemedicine/model.go \
        backend/internal/telemedicine/service.go \
        backend/internal/telemedicine/handler.go \
        backend/internal/app/finance_routes.go
git commit -m "feat(telemedicine): package-priced booking, pinned consult session, completion hook"
```

### Task 6: Veterinary tele-consults — package pricing, pinned session, completion hook

A vet sells a timed tele-consult as a published package (`vertical='vet'`,
`owner_kind='health_provider'`) exactly like a doctor does. Booking pins the
package's mode, duration and price onto `vet_appointment_payments`; the escrow
hold is unchanged (it already HELDs the owner payment on booking). Either party
opens the room through the same `EnsureSession`, and completing the consult
ends that one session. The legacy `health_consults` row is still started for the
vet because `CompleteConsult` (SOAP note, e-Rx, release) is anchored on it.

**Files:**
- Create: `backend/internal/health/vet/consult.go`
- Create: `backend/internal/health/vet/consult_test.go`
- Create: `backend/internal/health/vet/consult_live_db_test.go`
- Modify: `backend/internal/health/vet/service.go` (`BookInput`, `Service`, `Book`, `CompleteConsult`, `Appointment`, `load`)
- Modify: `backend/internal/health/vet/listing.go` (`VetListing.Packages`, `listingPackages`, `listingRows`)
- Modify: `backend/internal/health/vetapi/owner/appts.go` (`bookRequest`, `BookAppointment`, add `OpenConsultSession`)
- Modify: `backend/internal/health/vetapi/owner/register.go` (mount the route)
- Modify: `backend/internal/health/vetapi/provider/wire.go` (`ProviderID`, `Packages`)
- Modify: `backend/internal/health/vetapi/provider/profile.go` (populate the two new fields)
- Create: `backend/internal/health/vetapi/provider/consult_session.go`
- Modify: `backend/internal/health/vetapi/provider/register.go` (mount the route)

**Interfaces:**
- Consumes: `consultengine.EnsureSession(ctx, BookRequest) (Session, error)`, `consultengine.CompleteBySource(ctx, Vertical, sourceRef, callerID) error`, `consultengine.BookRequest`, `consultengine.PriceSnapshot` (Task 3); `vet_appointment_payments.consult_package_id/consult_mode/consult_duration_minutes` and `appointments` pins (Task 1).
- Produces:
  - `healthvet.BookInput` gains `PackageID string`, `ConsultMode string`, `ExpectedTotalKobo int64`.
  - `healthvet.Appointment` gains `ConsultPackageID *string`, `ConsultMode *string`, `ConsultDurationMinutes *int`.
  - `healthvet.ConsultRoomEngine` interface + `(*healthvet.Service).WithConsultRoomEngine(ConsultRoomEngine) *Service`.
  - Sentinels: `ErrPackageInvalid`, `ErrPackageRequired`, `ErrConsultModeInvalid`, `ErrQuoteMismatch`, `ErrConsultNotOpenable`, `ErrConsultUnavailable`.
  - `(*healthvet.Service).OpenConsultSession(ctx context.Context, callerID, apptID string) (consultengine.Session, error)`.
  - Routes: `POST /api/finance/health/vet/appointments/:id/consult-session` (owner), `POST /api/finance/health/vet/provider/appointments/:id/consult-session` (vet).
  - `healthvet.VetListing.Packages []ListingPackage`; `vetapi/provider` `wireProfile.ProviderID` and `wireProfile.Packages`.

- [ ] **Step 1: Write the failing pure test**

Create `backend/internal/health/vet/consult_test.go`:

```go
package healthvet

import (
	"errors"
	"testing"

	"spotlight/backend/internal/health/consultengine"
)

func TestNormalizeVetConsultMode(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    consultengine.Mode
		wantErr bool
	}{
		{"empty defaults to video", "", consultengine.ModeVideo, false},
		{"video", "video", consultengine.ModeVideo, false},
		{"case and padding", "  VIDEO ", consultengine.ModeVideo, false},
		{"tele alias", "tele", consultengine.ModeVideo, false},
		{"voice", "voice", consultengine.ModeVoice, false},
		{"audio alias", "audio", consultengine.ModeVoice, false},
		{"chat", "chat", consultengine.ModeChat, false},
		{"unknown", "fax", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeVetConsultMode(tc.in)
			if tc.wantErr {
				if !errors.Is(err, ErrConsultModeInvalid) {
					t.Fatalf("err = %v, want ErrConsultModeInvalid", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("mode = %q, want %q", got, tc.want)
			}
		})
	}
}

// The vet's unpaid-consult fallback predates LiveKit and is 30 minutes. The
// spec pins it so a legacy tele appointment keeps the length owners saw.
func TestLegacyVetConsultMinutesIsThirty(t *testing.T) {
	if legacyVetConsultMinutes != 30 {
		t.Fatalf("legacyVetConsultMinutes = %d, want 30", legacyVetConsultMinutes)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/health/vet -run 'TestNormalizeVetConsultMode|TestLegacyVetConsultMinutes' -count=1
```
Expected: FAIL — `undefined: normalizeVetConsultMode`, `undefined: ErrConsultModeInvalid`, `undefined: legacyVetConsultMinutes`.

- [ ] **Step 3: Write `consult.go`**

```go
package healthvet

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/health/consultengine"
)

// ConsultRoomEngine is the slice of the shared consult engine the vet vertical
// needs. The legacy `consult` field on Service is the older SOAP/clinical-note
// engine and must not be confused with it: that one is anchored to
// health_consults, this one owns the LiveKit room and its timer.
type ConsultRoomEngine interface {
	EnsureSession(ctx context.Context, req consultengine.BookRequest) (consultengine.Session, error)
	CompleteBySource(ctx context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error
}

// WithConsultRoomEngine wires the shared LiveKit consult engine. Nil is valid:
// tele booking and the legacy SOAP path keep working, and the room endpoint
// answers ErrConsultUnavailable.
func (s *Service) WithConsultRoomEngine(c ConsultRoomEngine) *Service {
	s.rooms = c
	return s
}

var (
	// ErrPackageInvalid means the package is not this vet's, is not a vet
	// package, or is no longer active.
	ErrPackageInvalid = errors.New("vet: consultation package is not available")
	// ErrPackageRequired means the vet sells timed sessions for the requested
	// mode, so a service price is no longer a valid price for it.
	ErrPackageRequired = errors.New("vet: choose a consultation package")
	// ErrConsultModeInvalid means the requested mode is not chat/voice/video.
	ErrConsultModeInvalid = errors.New("vet: unknown consultation mode")
	// ErrQuoteMismatch means the client-quoted total disagrees with the
	// server-computed price. Money has not moved when this is returned.
	ErrQuoteMismatch = errors.New("vet: the quoted total no longer matches this vet's price")
	// ErrConsultNotOpenable means the appointment is not a confirmed tele
	// consult (home/clinic visits, cancelled and completed rows never open).
	ErrConsultNotOpenable = errors.New("vet: this appointment is not an open tele-consult")
	// ErrConsultUnavailable means no media engine is wired.
	ErrConsultUnavailable = errors.New("vet: consult media is not available")
)

// legacyVetConsultMinutes is the duration of a tele appointment booked from a
// visit service rather than a package — unchanged from the pre-LiveKit vet flow.
const legacyVetConsultMinutes = 30

// normalizeVetConsultMode maps the app's mode spelling onto the engine's three
// modes. The pet flow historically says "tele" for a video consult.
func normalizeVetConsultMode(raw string) (consultengine.Mode, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "video", "tele":
		return consultengine.ModeVideo, nil
	case "audio", "voice":
		return consultengine.ModeVoice, nil
	case "chat":
		return consultengine.ModeChat, nil
	}
	return "", ErrConsultModeInvalid
}

// vetConsultPackage is the priced option a tele booking pinned.
type vetConsultPackage struct {
	ID              string
	Mode            consultengine.Mode
	DurationMinutes int
	PriceKobo       int64
}

// loadConsultPackage validates the picker's choice against the vet's own active
// package list. A package from another vet, another vertical, or an inactive
// row is the same refusal.
func (s *Service) loadConsultPackage(ctx context.Context, providerID, packageID string) (vetConsultPackage, error) {
	if _, err := uuid.Parse(packageID); err != nil {
		return vetConsultPackage{}, ErrPackageInvalid
	}
	var pkg vetConsultPackage
	var mode string
	const q = `SELECT id::text, mode, duration_minutes, price_kobo
	           FROM consult_session_packages
	           WHERE id=$1::uuid AND owner_kind='health_provider' AND owner_id=$2::uuid
	             AND vertical='vet' AND active=TRUE`
	err := s.db.QueryRow(ctx, q, packageID, providerID).
		Scan(&pkg.ID, &mode, &pkg.DurationMinutes, &pkg.PriceKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return vetConsultPackage{}, ErrPackageInvalid
	}
	if err != nil {
		return vetConsultPackage{}, fmt.Errorf("vet: load consult package: %w", err)
	}
	pkg.Mode = consultengine.Mode(mode)
	return pkg, nil
}

// providerSellsMode reports whether the vet publishes a timed package for a
// mode — which is what makes the legacy service price invalid for it.
func (s *Service) providerSellsMode(ctx context.Context, providerID string, m consultengine.Mode) (bool, error) {
	var sells bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM consult_session_packages
		WHERE owner_kind='health_provider' AND owner_id=$1::uuid
		  AND vertical='vet' AND mode=$2 AND active=TRUE)`
	if err := s.db.QueryRow(ctx, q, providerID, m).Scan(&sells); err != nil {
		return false, fmt.Errorf("vet: check consult packages: %w", err)
	}
	return sells, nil
}

// OpenConsultSession returns the single session pinned to a tele appointment,
// creating it on first open. Either the pet owner or the vet's owner may open
// it; a stranger gets the same not-found as a missing appointment.
//
// When the vet opens a CONFIRMED appointment that has no legacy consult row
// yet, this starts that row first. CompleteConsult (SOAP note, e-Rx, escrow
// release) is anchored on it, so opening the room must not leave the vet
// unable to finish the visit.
func (s *Service) OpenConsultSession(ctx context.Context, callerID, apptID string) (consultengine.Session, error) {
	if s.rooms == nil {
		return consultengine.Session{}, ErrConsultUnavailable
	}
	if _, err := uuid.Parse(apptID); err != nil {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	const q = `
		SELECT ap.patient_id::text, ap.provider_id::text, ap.visit_type, ap.state, ap.slot_start,
		       hp.owner_user_id::text, COALESCE(vp.escrow_id::text, ''),
		       COALESCE(vp.consult_package_id::text, ''),
		       COALESCE(vp.consult_mode, 'video'),
		       vp.total_kobo,
		       COALESCE(vp.consult_duration_minutes, 30),
		       vp.consult_id::text
		FROM health_appointments ap
		JOIN vet_appointment_payments vp ON vp.appointment_id = ap.id
		JOIN health_providers hp ON hp.id = ap.provider_id
		WHERE ap.id = $1::uuid`
	var patientID, providerID, visit, state, vetOwner, holdID, packageID, mode string
	var slotStart time.Time
	var totalKobo int64
	var durationMinutes int
	var consultID *string
	err := s.db.QueryRow(ctx, q, apptID).Scan(&patientID, &providerID, &visit, &state, &slotStart,
		&vetOwner, &holdID, &packageID, &mode, &totalKobo, &durationMinutes, &consultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if err != nil {
		return consultengine.Session{}, fmt.Errorf("vet: load consultation: %w", err)
	}
	if callerID != patientID && callerID != vetOwner {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if visit != string(VisitTele) || (state != string(StateConfirmed) && state != string(StateInProgress)) {
		return consultengine.Session{}, ErrConsultNotOpenable
	}
	if callerID == vetOwner && consultID == nil && state == string(StateConfirmed) {
		// Fail closed: without the legacy row the vet cannot complete the visit
		// or release the payment, so do not hand out a room we cannot close.
		if _, serr := s.StartConsult(ctx, callerID, apptID); serr != nil {
			return consultengine.Session{}, fmt.Errorf("vet: start consult: %w", serr)
		}
	}
	// An appointment opened more than five minutes late starts now, so the
	// owner still receives the full duration they paid for.
	start := slotStart
	if time.Now().After(slotStart.Add(5 * time.Minute)) {
		start = time.Time{}
	}
	return s.rooms.EnsureSession(ctx, consultengine.BookRequest{
		Vertical:          consultengine.VerticalVet,
		Mode:              consultengine.Mode(mode),
		PatientID:         patientID,
		ProviderOwnerKind: consultengine.OwnerHealthProvider,
		ProviderOwnerID:   providerID,
		ProviderUserID:    vetOwner,
		SourceRef:         "vet:" + apptID,
		PackageID:         packageID,
		BaseHoldID:        holdID,
		Start:             start,
		Snapshot: &consultengine.PriceSnapshot{
			DurationMinutes: durationMinutes,
			PriceKobo:       totalKobo,
		},
	})
}
```

- [ ] **Step 4: Add the field, the input fields, and package-aware pricing to `Book`**

In `service.go`, add to the `Service` struct after `consult`:

```go
	// rooms is the shared LiveKit consult engine (consult.go). Nil means timed
	// tele sessions are not wired — booking and SOAP completion still work.
	rooms ConsultRoomEngine
```

Add to `BookInput`:

```go
	// PackageID pins a published timed tele-consult package. When set, its
	// mode, duration and price replace the visit service for a TELE booking.
	PackageID string
	// ConsultMode is the requested chat/voice/video mode for a TELE booking
	// without a package ("" means video).
	ConsultMode string
	// ExpectedTotalKobo is the total the client showed the owner. A non-zero
	// value that disagrees with the server price refuses the booking before any
	// money moves.
	ExpectedTotalKobo int64
```

In `Book`, replace the price block (from `// Price from the pinned service (server-side, kobo integers).` through the `if total <= 0 { ... }` block) with:

```go
	// Resolve the mode a TELE appointment runs. A package may override it, but
	// the request must still name a mode the engine understands.
	var consultMode *string
	if in.VisitType == VisitTele {
		m, err := normalizeVetConsultMode(in.ConsultMode)
		if err != nil {
			return nil, err
		}
		ms := string(m)
		consultMode = &ms
	}

	// Price from the pinned package or service (server-side, kobo integers). A
	// timed tele package carries its own duration and price; every other visit
	// prices from the vet's active service exactly as before.
	var total int64
	var packageID *string
	var durationMinutes *int
	switch {
	case strings.TrimSpace(in.PackageID) != "":
		if in.VisitType != VisitTele {
			return nil, ErrPackageInvalid
		}
		pkg, err := s.loadConsultPackage(ctx, in.ProviderID, in.PackageID)
		if err != nil {
			return nil, err
		}
		total = pkg.PriceKobo
		packageID = &pkg.ID
		ms := string(pkg.Mode)
		consultMode = &ms
		durationMinutes = &pkg.DurationMinutes
	case in.VisitType == VisitTele && strings.TrimSpace(in.ServiceID) == "":
		// A tele vet may sell packages instead of a visit service. Without one
		// or the other the price is unknowable; say which is missing.
		sells, err := s.providerSellsMode(ctx, in.ProviderID, consultengine.Mode(*consultMode))
		if err != nil {
			return nil, err
		}
		if sells {
			return nil, ErrPackageRequired
		}
		return nil, errors.New("vet: service not found for this vet")
	default:
		var active bool
		const sq = `SELECT price_kobo, active FROM vet_services WHERE id=$1 AND provider_id=$2`
		if err := s.db.QueryRow(ctx, sq, in.ServiceID, in.ProviderID).Scan(&total, &active); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, errors.New("vet: service not found for this vet")
			}
			return nil, err
		}
		if !active {
			return nil, errors.New("vet: service is not active")
		}
		if in.VisitType == VisitTele {
			sells, err := s.providerSellsMode(ctx, in.ProviderID, consultengine.Mode(*consultMode))
			if err != nil {
				return nil, err
			}
			if sells {
				return nil, ErrPackageRequired
			}
		}
	}
	if total <= 0 {
		return nil, errors.New("vet: appointment total must be positive")
	}
	if in.ExpectedTotalKobo > 0 && in.ExpectedTotalKobo != total {
		return nil, ErrQuoteMismatch
	}
```

Add the import `"spotlight/backend/internal/health/consultengine"` to `service.go`.

Replace the payment INSERT block with:

```go
	// A package-priced tele booking has no visit service; the FK is nullable
	// for exactly that case.
	var serviceID *string
	if strings.TrimSpace(in.ServiceID) != "" {
		sid := in.ServiceID
		serviceID = &sid
	}
```

immediately before `payErr := func() error {`, then replace the INSERT inside it with:

```go
		const insPay = `
			INSERT INTO vet_appointment_payments
				(id, appointment_id, owner_id, provider_id, pet_id, service_id, visit_type,
				 total_kobo, escrow_id, pay_state, idempotency_key,
				 consult_package_id, consult_mode, consult_duration_minutes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'HELD',$10,$11,$12,$13)`
		if _, err := tx.Exec(ctx, insPay, uuid.New().String(), appt.ID, ownerID, in.ProviderID,
			in.PetID, serviceID, string(in.VisitType), total, escrowID, in.IdempotencyKey,
			packageID, consultMode, durationMinutes); err != nil {
			return fmt.Errorf("vet: insert appointment payment: %w", err)
		}
```

Replace the returned `Appointment` literal so it carries the pins (and drop the now-unused local `serviceID := in.ServiceID` shadow):

```go
	out := &Appointment{
		ID: appt.ID, ProviderID: in.ProviderID, OwnerID: ownerID, PetID: in.PetID,
		ServiceID: serviceID, VisitType: in.VisitType, State: StateRequested,
		PayState: PayHeld, TotalKobo: total, EscrowID: &escrowID,
		ConsultPackageID: packageID, ConsultMode: consultMode,
		ConsultDurationMinutes: durationMinutes,
		SlotStart: in.SlotStart, SlotEnd: in.SlotEnd, CreatedAt: time.Now(),
	}
```

- [ ] **Step 5: Expose the pins on `Appointment` and in `load`**

Add to the `Appointment` struct after `ConsultID`:

```go
	// The pinned consult price point. Nil for legacy appointments and for
	// HOME/CLINIC visits; a pinned duration wins over the module fallback.
	ConsultPackageID       *string `json:"consult_package_id,omitempty"`
	ConsultMode            *string `json:"consult_mode,omitempty"`
	ConsultDurationMinutes *int    `json:"consult_duration_minutes,omitempty"`
```

In `load`, replace the SELECT column list and the Scan call:

```go
	const q = `
		SELECT ap.id, ap.provider_id, ap.patient_id, ap.visit_type, ap.state, ap.slot_start, ap.slot_end,
		       vp.pet_id, vp.service_id, vp.total_kobo, vp.escrow_id, vp.consult_id, vp.delivery_ref, vp.pay_state,
		       vp.consult_package_id, vp.consult_mode, vp.consult_duration_minutes, ap.created_at
		FROM health_appointments ap
		JOIN vet_appointment_payments vp ON vp.appointment_id = ap.id
		WHERE ap.id=$1`
	if err := s.db.QueryRow(ctx, q, apptID).Scan(&a.ID, &a.ProviderID, &a.OwnerID, &visit, &state,
		&a.SlotStart, &a.SlotEnd, &a.PetID, &a.ServiceID, &a.TotalKobo, &a.EscrowID, &a.ConsultID,
		&a.DeliveryRef, &payState, &a.ConsultPackageID, &a.ConsultMode, &a.ConsultDurationMinutes,
		&a.CreatedAt); err != nil {
```

- [ ] **Step 6: End the pinned session when the consult completes**

In `CompleteConsult`, immediately after `res.Appointment = a` and before `return res, nil`, add:

```go
	// The payment is already released; ending the room is best-effort. The
	// sweeper still ends it at ends_at, so a media hiccup must not fail a
	// consult that has already settled.
	if s.rooms != nil {
		if cerr := s.rooms.CompleteBySource(ctx, consultengine.VerticalVet,
			"vet:"+apptID, vetOwnerID); cerr != nil {
			log.Printf("[vet] complete consult session %s: %v", apptID, cerr)
		}
	}
```

- [ ] **Step 7: Publish the vet's packages in the public listing**

In `listing.go`, add to `VetListing` after `Active`:

```go
	// Packages are the vet's published timed tele-consult price points. Empty
	// when the vet sells tele visits through vet_services only.
	Packages []ListingPackage `json:"packages"`
```

Add below the struct:

```go
// ListingPackage is one priced timed consult option in the public listing. The
// picker sends its id back as packageId; the server re-prices from the row.
type ListingPackage struct {
	ID              string `json:"id"`
	Mode            string `json:"mode"`
	DurationMinutes int    `json:"durationMinutes"`
	PriceKobo       int64  `json:"priceKobo"`
}
```

In `listingRows`, after the `fees, err := s.listingFees(ctx, ids)` block, add:

```go
	packages, err := s.listingPackages(ctx, ids)
	if err != nil {
		return nil, err
	}
```

and inside the fill loop, after `l.Types = fee.types`:

```go
		l.Packages = packages[l.ID]
		if l.Packages == nil {
			l.Packages = []ListingPackage{}
		}
```

Append the query beside `listingFees`:

```go
// listingPackages returns the active timed consult packages for each provider,
// cheapest first, keyed by provider id. Providers selling none are absent.
func (s *Service) listingPackages(ctx context.Context, providerIDs []string) (map[string][]ListingPackage, error) {
	const q = `
		SELECT owner_id::text, id::text, mode, duration_minutes, price_kobo
		FROM consult_session_packages
		WHERE active = true AND vertical = 'vet' AND owner_kind = 'health_provider'
		  AND owner_id = ANY($1::uuid[])
		ORDER BY owner_id, mode, price_kobo, duration_minutes`
	rows, err := s.db.Query(ctx, q, providerIDs)
	if err != nil {
		return nil, fmt.Errorf("vet: listing packages: %w", err)
	}
	defer rows.Close()
	out := map[string][]ListingPackage{}
	for rows.Next() {
		var pid string
		var pkg ListingPackage
		if err := rows.Scan(&pid, &pkg.ID, &pkg.Mode, &pkg.DurationMinutes, &pkg.PriceKobo); err != nil {
			return nil, err
		}
		out[pid] = append(out[pid], pkg)
	}
	return out, rows.Err()
}
```

- [ ] **Step 8: Accept packages in the owner booking handler and expose the room route**

In `vetapi/owner/appts.go`, add the consult query fields to `bookRequest` after `IdempotencyKey`:

```go
	// Tele-consult pricing. packageId selects one of the vet's published timed
	// packages; consultMode is the requested mode for a legacy (service-priced)
	// tele booking; expectedTotalKobo is the total the app showed the owner.
	PackageID         string `json:"packageId"`
	ConsultMode       string `json:"consultMode"`
	ExpectedTotalKobo int64  `json:"expectedTotalKobo"`
```

Replace the service-resolution block in `BookAppointment` (from `var serviceID string` through the `if err != nil { ... }` that returns 500) with:

```go
	var serviceID string
	if strings.TrimSpace(req.PackageID) == "" {
		err := h.db.QueryRow(ctx, `
			SELECT id::text FROM vet_services
			WHERE provider_id = $1::uuid AND visit_type = $2 AND active
			ORDER BY price_kobo ASC, created_at ASC LIMIT 1`, req.VetID, visit).Scan(&serviceID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// A tele vet may sell timed packages instead of a visit service.
			// Leave the id empty and let healthvet.Book distinguish
			// ErrPackageRequired from "this vet does not offer TELE".
			if visit != "TELE" {
				fail(c, http.StatusUnprocessableEntity, "this vet does not offer "+visitWire(visit)+" visits")
				return
			}
		case err != nil:
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
```

Replace the `healthvet.BookInput` literal with:

```go
	a, err := h.svc.Book(ctx, uid, healthvet.BookInput{
		ProviderID: req.VetID, PetID: req.PetID, ServiceID: serviceID,
		PackageID: req.PackageID, ConsultMode: req.ConsultMode,
		ExpectedTotalKobo: req.ExpectedTotalKobo,
		VisitType:         healthvet.VisitType(visit), SlotStart: start, SlotEnd: start.Add(slotLength),
		IdempotencyKey: idem,
	})
```

Extend the error switch in `BookAppointment` before `default`:

```go
		case errors.Is(err, healthvet.ErrPackageRequired), errors.Is(err, healthvet.ErrPackageInvalid),
			errors.Is(err, healthvet.ErrConsultModeInvalid), errors.Is(err, healthvet.ErrQuoteMismatch):
			fail(c, http.StatusUnprocessableEntity, err.Error())
```

Add the handler below `BookAppointment` (import `"spotlight/backend/internal/health/consultengine"` at the top of the file):

```go
// OpenConsultSession — POST /appointments/:id/consult-session. Either the pet
// owner or the vet's owner may open the room; a stranger gets the same 404 a
// missing appointment returns, so existence is never confirmed.
func (h *Handler) OpenConsultSession(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "appointment id")
	if !ok {
		return
	}
	sess, err := h.svc.OpenConsultSession(c.Request.Context(), uid, id)
	if err != nil {
		switch {
		case errors.Is(err, healthvet.ErrAppointmentNotFound):
			fail(c, http.StatusNotFound, "appointment not found")
		case errors.Is(err, healthvet.ErrConsultNotOpenable):
			fail(c, http.StatusConflict, err.Error())
		case errors.Is(err, healthvet.ErrConsultUnavailable),
			errors.Is(err, consultengine.ErrMediaUnavailable),
			errors.Is(err, consultengine.ErrEscrowUnavailable):
			fail(c, http.StatusServiceUnavailable, err.Error())
		case errors.Is(err, consultengine.ErrInvalid), errors.Is(err, consultengine.ErrState):
			fail(c, http.StatusConflict, err.Error())
		default:
			fail(c, http.StatusInternalServerError, err.Error())
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "session": sess})
}
```

In `vetapi/owner/register.go`, inside `RegisterAppointmentAdapters`, after the `vg.POST("/appointments/:id/reschedule", ...)` line:

```go
	vg.POST("/appointments/:id/consult-session", h.OpenConsultSession)
```

- [ ] **Step 9: Expose packages and a room route on the vet's workspace**

In `vetapi/provider/wire.go`, add to `wireProfile` before `Credential`:

```go
	// ProviderID is the health_providers row id — the owner id the consult
	// engine keys packages and sessions on. Empty before onboarding exists.
	ProviderID string        `json:"providerId,omitempty"`
	Packages   []wirePackage `json:"packages"`
```

and add below `wireProfile`:

```go
// wirePackage is one published timed-consult price point shown in the vet's
// workspace. The patient's copy of the same data comes from the public listing.
type wirePackage struct {
	ID              string `json:"id"`
	Mode            string `json:"mode"`
	DurationMinutes int    `json:"durationMinutes"`
	PriceKobo       int64  `json:"priceKobo"`
}
```

In `vetapi/provider/profile.go`, change the `buildProfile` literal to:

```go
	out := wireProfile{Types: []string{}, Species: []string{}, Packages: []wirePackage{}, Status: "draft"}
```

and inside the final `if p != nil { ... }` block (after the `sort.Strings(out.Types)` line, still inside the block), add:

```go
		out.ProviderID = p.ID
		pkgRows, err := h.db.Query(ctx, `
			SELECT id::text, mode, duration_minutes, price_kobo
			FROM consult_session_packages
			WHERE owner_kind='health_provider' AND owner_id=$1
			  AND vertical='vet' AND active=TRUE
			ORDER BY mode, price_kobo, duration_minutes`, p.ID)
		if err != nil {
			return out, err
		}
		defer pkgRows.Close()
		for pkgRows.Next() {
			var pkg wirePackage
			if err := pkgRows.Scan(&pkg.ID, &pkg.Mode, &pkg.DurationMinutes, &pkg.PriceKobo); err != nil {
				return out, err
			}
			out.Packages = append(out.Packages, pkg)
		}
		if err := pkgRows.Err(); err != nil {
			return out, err
		}
```

Create `vetapi/provider/consult_session.go`:

```go
package provider

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/health/consultengine"
	healthvet "spotlight/backend/internal/health/vet"
)

// OpenConsultSession — POST /provider/appointments/:id/consult-session. The vet
// opens the room from the workspace; the engine pins the session to the
// appointment, so the owner opening theirs converges on the same row. Opening
// also starts the legacy consult row when it has not been started yet, which is
// what the SOAP completion path releases payment against.
func (h *Handler) OpenConsultSession(c *gin.Context) {
	uid, _, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	apptID, ok := pathID(c, "id")
	if !ok {
		return
	}
	if h.vet == nil {
		fail(c, http.StatusServiceUnavailable, "consult media is not available")
		return
	}
	sess, err := h.vet.OpenConsultSession(c.Request.Context(), uid, apptID)
	if err != nil {
		switch {
		case errors.Is(err, healthvet.ErrAppointmentNotFound):
			fail(c, http.StatusNotFound, "appointment not found")
		case errors.Is(err, healthvet.ErrConsultNotOpenable):
			fail(c, http.StatusConflict, err.Error())
		case errors.Is(err, healthvet.ErrConsultUnavailable),
			errors.Is(err, consultengine.ErrMediaUnavailable),
			errors.Is(err, consultengine.ErrEscrowUnavailable):
			fail(c, http.StatusServiceUnavailable, err.Error())
		case errors.Is(err, consultengine.ErrInvalid), errors.Is(err, consultengine.ErrState):
			fail(c, http.StatusConflict, err.Error())
		default:
			fail(c, http.StatusInternalServerError, err.Error())
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "session": sess})
}
```

In `vetapi/provider/register.go`, inside `mount`, after `vg.POST("/provider/appointments/:id/soap", h.SaveSoap)`:

```go
	vg.POST("/provider/appointments/:id/consult-session", h.OpenConsultSession)
```

- [ ] **Step 10: Build, vet, and run the pure tests**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/health/vet -run 'TestNormalizeVetConsultMode|TestLegacyVetConsultMinutes' -count=1 -v
go build ./... && go vet ./...
```
Expected: two PASS, then no output and exit 0.

- [ ] **Step 11: Write the live tests**

Create `backend/internal/health/vet/consult_live_db_test.go`:

```go
package healthvet

// LIVE-DB coverage for the vet Slice 2 path: package-priced tele booking pins
// mode/duration/price, the quote guard refuses a stale total before money
// moves, and OpenConsultSession resolves the one session per appointment with
// participant scoping. Skips unless TEST_DATABASE_URL is set:
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/health/vet -run TestLiveDB_VetConsult -v

import (
	"context"
	"errors"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/health/consultengine"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/testsupport"
)

func seedVetConsultPackage(t *testing.T, ctx context.Context, pool *pgxpool.Pool, providerID, mode string, minutes int, price int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO consult_session_packages
		    (id, owner_kind, owner_id, vertical, mode, duration_minutes, price_kobo, active)
		VALUES ($1,'health_provider',$2,'vet',$3,$4,$5,true)`,
		id, providerID, mode, minutes, price); err != nil {
		t.Fatalf("seed vet package: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM consult_session_packages WHERE id=$1`, id)
	})
	return id
}

func fundVetConsultWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amount int64) {
	t.Helper()
	acc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "vet-consult-seed", "vet-consult-fund-"+uuid.New().String(), acc.ID, amount); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// fakeRoomEngine records what the vet module asked the engine to open.
type fakeRoomEngine struct {
	reqs      []consultengine.BookRequest
	completed []string
}

func (f *fakeRoomEngine) EnsureSession(_ context.Context, req consultengine.BookRequest) (consultengine.Session, error) {
	f.reqs = append(f.reqs, req)
	return consultengine.Session{
		ID: "sess-" + req.SourceRef, Vertical: req.Vertical, Mode: req.Mode,
		SourceRef: req.SourceRef, State: consultengine.StateScheduled,
	}, nil
}

func (f *fakeRoomEngine) CompleteBySource(_ context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error {
	f.completed = append(f.completed, string(vertical)+"/"+sourceRef+"/"+callerID)
	return nil
}

func TestLiveDB_VetConsult_BookPackagePinsModeDurationPrice(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID := uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	testsupport.SetKycTier(t, ctx, pool, ownerID, testsupport.KycTierUnlimited)
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)
	// No vet_services row: this vet sells the tele consult as a timed package.
	packageID := seedVetConsultPackage(t, ctx, pool, providerID, "video", 30, 250_000)

	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, healthscheduling.NewService(pool, scheduler.NewService(pool), nil),
		nil, nil, nil, nil, nil)
	fundVetConsultWallet(t, ctx, led, ownerID, 5_000_000)

	start := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	appt, err := svc.Book(ctx, ownerID, BookInput{
		ProviderID: providerID, PetID: petID, PackageID: packageID,
		VisitType: VisitTele, ConsultMode: "video",
		SlotStart: start, SlotEnd: start.Add(30 * time.Minute),
		ExpectedTotalKobo: 250_000,
		IdempotencyKey:    "vet-consult-pkg-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book pinned package: %v", err)
	}
	if appt.TotalKobo != 250_000 {
		t.Fatalf("total = %d, want the package price 250000", appt.TotalKobo)
	}
	if appt.ServiceID != nil {
		t.Fatalf("service id = %v, want nil for a package booking", *appt.ServiceID)
	}
	if appt.ConsultPackageID == nil || *appt.ConsultPackageID != packageID {
		t.Fatalf("package pin = %v, want %s", appt.ConsultPackageID, packageID)
	}
	if appt.ConsultMode == nil || *appt.ConsultMode != "video" {
		t.Fatalf("mode pin = %v, want video", appt.ConsultMode)
	}
	if appt.ConsultDurationMinutes == nil || *appt.ConsultDurationMinutes != 30 {
		t.Fatalf("duration pin = %v, want 30", appt.ConsultDurationMinutes)
	}
}

func TestLiveDB_VetConsult_StaleQuoteRefusedBeforeMoneyMoves(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID := uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	testsupport.SetKycTier(t, ctx, pool, ownerID, testsupport.KycTierUnlimited)
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)
	packageID := seedVetConsultPackage(t, ctx, pool, providerID, "voice", 20, 180_000)

	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, healthscheduling.NewService(pool, scheduler.NewService(pool), nil),
		nil, nil, nil, nil, nil)
	fundVetConsultWallet(t, ctx, led, ownerID, 5_000_000)

	start := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	_, err := svc.Book(ctx, ownerID, BookInput{
		ProviderID: providerID, PetID: petID, PackageID: packageID,
		VisitType: VisitTele, SlotStart: start, SlotEnd: start.Add(30 * time.Minute),
		ExpectedTotalKobo: 150_000,
		IdempotencyKey:    "vet-consult-stale-" + uuid.New().String(),
	})
	if !errors.Is(err, ErrQuoteMismatch) {
		t.Fatalf("stale quote must fail on ErrQuoteMismatch, got %v", err)
	}
	var appts int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_appointments WHERE patient_id=$1`, ownerID).Scan(&appts); err != nil {
		t.Fatalf("count appointments: %v", err)
	}
	if appts != 0 {
		t.Fatalf("a refused quote must not mint an appointment, found %d", appts)
	}
}

func TestLiveDB_VetConsult_OpenSessionScopesParticipants(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID, strangerID := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID, strangerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)

	apptID := uuid.New().String()
	slot := time.Now().Add(time.Hour).Truncate(time.Minute)
	if _, err := pool.Exec(ctx, `
		INSERT INTO health_appointments
		    (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1,$2,$3,'PET','TELE','IN_PROGRESS',$4,$5)`,
		apptID, providerID, ownerID, slot, slot.Add(30*time.Minute)); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		bg := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(bg, `DELETE FROM vet_appointment_payments WHERE appointment_id=$1`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM health_appointments WHERE id=$1`, apptID)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO vet_appointment_payments
		    (appointment_id, owner_id, provider_id, pet_id, visit_type, total_kobo, pay_state,
		     idempotency_key, consult_mode, consult_duration_minutes)
		VALUES ($1,$2,$3,$4,'TELE',250000,'HELD',$5,'video',30)`,
		apptID, ownerID, providerID, petID, "vet-open-"+apptID); err != nil {
		t.Fatalf("seed payment: %v", err)
	}

	engine := &fakeRoomEngine{}
	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, nil, nil, nil, nil, nil, nil).WithConsultRoomEngine(engine)

	if _, err := svc.OpenConsultSession(ctx, strangerID, apptID); !errors.Is(err, ErrAppointmentNotFound) {
		t.Fatalf("stranger must get ErrAppointmentNotFound, got %v", err)
	}
	if len(engine.reqs) != 0 {
		t.Fatal("a stranger must never reach the media engine")
	}

	sess, err := svc.OpenConsultSession(ctx, ownerID, apptID)
	if err != nil {
		t.Fatalf("owner open: %v", err)
	}
	if sess.SourceRef != "vet:"+apptID {
		t.Fatalf("source ref = %q, want vet:%s", sess.SourceRef, apptID)
	}
	req := engine.reqs[len(engine.reqs)-1]
	if req.Vertical != consultengine.VerticalVet || req.Mode != consultengine.ModeVideo {
		t.Fatalf("vertical/mode = %q/%q", req.Vertical, req.Mode)
	}
	if req.ProviderOwnerKind != consultengine.OwnerHealthProvider ||
		req.ProviderOwnerID != providerID || req.ProviderUserID != vetOwnerID {
		t.Fatalf("provider = %q/%q/%q", req.ProviderOwnerKind, req.ProviderOwnerID, req.ProviderUserID)
	}
	if req.Snapshot == nil || req.Snapshot.DurationMinutes != 30 || req.Snapshot.PriceKobo != 250_000 {
		t.Fatalf("snapshot = %+v, want 30m/250000", req.Snapshot)
	}

	if _, err := svc.OpenConsultSession(ctx, vetOwnerID, apptID); err != nil {
		t.Fatalf("vet open of an IN_PROGRESS consult: %v", err)
	}
}

func TestLiveDB_VetConsult_NonTeleAppointmentIsNotOpenable(t *testing.T) {
	pool := vetUnwindPool(t)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	ownerID, vetOwnerID := uuid.New().String(), uuid.New().String()
	for _, u := range []string{ownerID, vetOwnerID} {
		seedVetTestUser(t, ctx, pool, u)
	}
	providerID := seedVetProvider(t, ctx, pool, vetOwnerID)
	petID := seedVetPet(t, ctx, pool, ownerID)

	apptID := uuid.New().String()
	slot := time.Now().Add(24 * time.Hour).Truncate(time.Minute)
	if _, err := pool.Exec(ctx, `
		INSERT INTO health_appointments
		    (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1,$2,$3,'PET','HOME','CONFIRMED',$4,$5)`,
		apptID, providerID, ownerID, slot, slot.Add(30*time.Minute)); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		bg := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(bg, `DELETE FROM vet_appointment_payments WHERE appointment_id=$1`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM health_appointments WHERE id=$1`, apptID)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO vet_appointment_payments
		    (appointment_id, owner_id, provider_id, pet_id, visit_type, total_kobo, pay_state, idempotency_key)
		VALUES ($1,$2,$3,$4,'HOME',1200000,'HELD',$5)`,
		apptID, ownerID, providerID, petID, "vet-home-"+apptID); err != nil {
		t.Fatalf("seed payment: %v", err)
	}

	svc := NewService(pool, vetUnwindEscrow{e: escrow.NewService(pool, led, nil)}, nil,
		fakeVCNGate{providerID: providerID, vetOwnerID: vetOwnerID, approved: true},
		nil, nil, nil, nil, nil, nil, nil).WithConsultRoomEngine(&fakeRoomEngine{})

	if _, err := svc.OpenConsultSession(ctx, ownerID, apptID); !errors.Is(err, ErrConsultNotOpenable) {
		t.Fatalf("a home visit must not open a room, got %v", err)
	}
}
```

- [ ] **Step 12: Run the live tests**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/health/vet -run 'TestLiveDB_VetConsult' -count=1 -v
```
Expected: four PASS. If the payment row rejects `consult_package_id`, re-run Task 1 Step 4 first (`supabase migration up --include-all`).

- [ ] **Step 13: Run the vet module suites**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/health/vet ./internal/health/vetapi/... ./internal/app -count=1
```
Expected: all PASS — the legacy booking/unwind, owner and provider suites must still pass unchanged.

- [ ] **Step 14: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/health/vet/consult.go \
        backend/internal/health/vet/consult_test.go \
        backend/internal/health/vet/consult_live_db_test.go \
        backend/internal/health/vet/service.go \
        backend/internal/health/vet/listing.go \
        backend/internal/health/vetapi/owner/appts.go \
        backend/internal/health/vetapi/owner/register.go \
        backend/internal/health/vetapi/provider/wire.go \
        backend/internal/health/vetapi/provider/profile.go \
        backend/internal/health/vetapi/provider/consult_session.go \
        backend/internal/health/vetapi/provider/register.go
git commit -m "feat(vet): package-priced tele-consult booking and pinned LiveKit session"
```

### Task 7: Media provider selection and wiring the engine into both modules

`CONSULT_MEDIA_PROVIDER` chooses the rail for timed health consults:
`livekit` (default) or `videosdk`. Modules are handed the engine only under
`livekit`; under `videosdk` the booking keeps its legacy shape and the
consult-session endpoint answers 503, which is the rollback story the spec
requires (no redeploy of the app, one env var). The engine is also built
before the health modules today, so the vet service can receive it at
construction.

**Files:**
- Create: `backend/internal/config/consult_media_test.go`
- Modify: `backend/internal/config/config.go` (`ConsultMediaProvider`, `Load`, `ConsultUsesLiveKit`)
- Modify: `backend/internal/app/finance_routes.go` (hoist `RegisterConsult`, inject into telemedicine)
- Modify: `backend/internal/app/health_vet_routes.go` (`RegisterHealthVet` param + injection)
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: `consultengine.NewService` (already built by `RegisterConsult`), `telemedicine.WithConsultEngine` (Task 5), `healthvet.WithConsultRoomEngine` (Task 6).
- Produces:
  - `config.Config.ConsultMediaProvider string`; `func (c Config) ConsultUsesLiveKit() bool`.
  - `RegisterHealthVet(..., consultRooms *consultengine.Service)`.
  - Compile-time proofs: `*consultengine.Service` satisfies `telemedicine.ConsultEngine` and `healthvet.ConsultRoomEngine`.

- [ ] **Step 1: Write the failing config test**

Create `backend/internal/config/consult_media_test.go`:

```go
package config

import "testing"

func TestConsultUsesLiveKit(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{"unset defaults to livekit", "", true},
		{"livekit", "livekit", true},
		{"case and padding", "  LiveKit ", true},
		{"videosdk rollback", "videosdk", false},
		{"videosdk any case", "VideoSDK", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := (Config{ConsultMediaProvider: tc.raw}).ConsultUsesLiveKit(); got != tc.want {
				t.Fatalf("ConsultUsesLiveKit() = %v, want %v", got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/config -run TestConsultUsesLiveKit -count=1
```
Expected: FAIL — `Config{}.ConsultMediaProvider undefined`, `ConsultUsesLiveKit undefined`.

- [ ] **Step 3: Add the config field, loader and method**

In `config.go`, add to `Config` immediately after the LiveKit block:

```go
	// ConsultMediaProvider selects the media rail for timed health consults:
	// "livekit" (the default) or "videosdk" (rollback — modules keep their
	// legacy VideoSDK room and no consult engine is wired).
	ConsultMediaProvider string
```

In `Load()`, next to the `FeatureLiveKitEnabled` entry, add:

```go
		ConsultMediaProvider:   getEnv("CONSULT_MEDIA_PROVIDER", "livekit"),
```

Append the method (the file already imports `strings`):

```go
// ConsultUsesLiveKit reports whether timed health consults run on LiveKit.
// "videosdk" is the explicit rollback. Any other value — including unset —
// selects LiveKit; with FEATURE_LIVEKIT_ENABLED off the engine still fails
// closed with ErrMediaUnavailable rather than fabricating a room.
func (c Config) ConsultUsesLiveKit() bool {
	return strings.ToLower(strings.TrimSpace(c.ConsultMediaProvider)) != "videosdk"
}
```

- [ ] **Step 4: Hoist the engine above the health modules and share it**

In `finance_routes.go`, add the imports `"spotlight/backend/internal/health/consultengine"` and `healthvet "spotlight/backend/internal/health/vet"`.

Immediately BEFORE `if cfg.FeatureHealthEnabled && pool != nil {`, insert:

```go
	// Paid consult sessions (telemedicine, vet, pharmacy, lab). Built BEFORE the
	// health modules so the vet and telemedicine services receive the same
	// engine at construction time; the HTTP surface stays inert until a module
	// books a session, and media fails closed when LiveKit is off.
	var consultRooms *consultengine.Service
	if pool != nil {
		consultRooms = RegisterConsult(r, mapsAuth(), pool, ledgerSvc, lkClient, cfg, auditSink)
		if consultRooms != nil {
			go consultRooms.RunSweeper(context.Background(), 30*time.Second)
		}
	}
	// Compile-time proof that the engine satisfies both module seams. If either
	// interface drifts, this file stops building rather than a booking failing
	// at runtime.
	var (
		_ healthvet.ConsultRoomEngine = consultRooms
		_ telemedicine.ConsultEngine  = consultRooms
	)
```

Delete the old block near the end of the function:

```go
	// Paid consult sessions (telemedicine, vet, pharmacy, lab). Inert until a
	// module books a session; media fails closed when LiveKit is off.
	if pool != nil {
		if consultSvc := RegisterConsult(r, mapsAuth(), pool, ledgerSvc, lkClient, cfg, auditSink); consultSvc != nil {
			go consultSvc.RunSweeper(context.Background(), 30*time.Second)
		}
	}
```

- [ ] **Step 5: Wire the engine into the telemedicine service**

In the `if cfg.FeatureTelemedicineEnabled {` block, after the `telemedSvc = telemedSvc.WithNotifier(...)` assignment and before `telemedHandler := telemedicine.NewHandler(telemedSvc)`, add:

```go
		// Timed consults run on the shared engine when LiveKit is the selected
		// media rail. The videosdk rollback leaves the module on its legacy
		// VideoSDK room and the consult-session endpoint answers 503.
		if consultRooms != nil && cfg.ConsultUsesLiveKit() {
			telemedSvc = telemedSvc.WithConsultEngine(consultRooms)
		}
```

- [ ] **Step 6: Wire the engine into the vet service**

In `health_vet_routes.go`, change the signature to:

```go
func RegisterHealthVet(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, cfg config.Config, supabase *integrations.SupabaseRestClient, audit services.AuditService, consultRooms *consultengine.Service) {
```

Add `"spotlight/backend/internal/health/consultengine"` to its imports. After `svc.SetCapabilityStatusSetter(...)`, add:

```go
	// Timed tele-consults run on the shared engine when LiveKit is the selected
	// media rail. The videosdk rollback leaves it unwired: booking keeps its
	// legacy shape and the room endpoint fails closed with ErrConsultUnavailable.
	if consultRooms != nil && cfg.ConsultUsesLiveKit() {
		svc = svc.WithConsultRoomEngine(consultRooms)
	}
```

In `finance_routes.go`, pass the engine at the existing call site:

```go
			RegisterHealthVet(finance, r.Group("/api/health/vet/admin"), pool, rbac, cfg, supabase, auditSink, consultRooms)
```

- [ ] **Step 7: Document the switch**

Append to `backend/.env.example`:

```dotenv
# Timed health consults (telemedicine + veterinary). "livekit" (the default)
# runs paid chat/voice/video sessions on the self-hosted SFU — it also needs
# FEATURE_LIVEKIT_ENABLED=true and the LIVEKIT_* values below. "videosdk" is
# the explicit rollback: modules keep their legacy VideoSDK room and the
# consult-session endpoint answers 503. No app change is needed to roll back.
CONSULT_MEDIA_PROVIDER=livekit
```

- [ ] **Step 8: Build, vet, and run the affected suites**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/backend
go test ./internal/config -run TestConsultUsesLiveKit -count=1 -v
go test ./internal/app -run 'TestConsult' -count=1
go build ./... && go vet ./...
```
Expected: five PASS, the app consult suite PASS, then no output and exit 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add backend/internal/config/config.go \
        backend/internal/config/consult_media_test.go \
        backend/internal/app/finance_routes.go \
        backend/internal/app/health_vet_routes.go \
        backend/.env.example
git commit -m "feat(consult): select livekit or videosdk and wire the engine into vet and telemedicine"
```

### Task 8: Mobile consult core — wire types, server-clock timer, API client, package picker

One shared client for both modules. Nothing here imports a LiveKit SDK: the
wire shapes, the clock math and the HTTP calls are platform-neutral, so they
can be tested with plain Node and reused by the web and native room files in
Task 9. The timer follows the server, not the device: a phone whose clock is
minutes off must still warn at the server's `warn_at` and expire at `ends_at`.

**Files:**
- Create: `mobile-app/reactnative/src/features/consult/types.ts`
- Create: `mobile-app/reactnative/src/features/consult/sessionTimer.ts`
- Create: `mobile-app/reactnative/src/features/consult/__tests__/sessionTimer.test.ts`
- Create: `mobile-app/reactnative/src/features/consult/api.ts`
- Create: `mobile-app/reactnative/src/features/consult/PackagePicker.tsx`
- Create: `mobile-app/reactnative/src/features/consult/index.ts`
- Modify: `mobile-app/reactnative/package.json` (`test:consult`)

**Interfaces:**
- Consumes: engine JSON from `consultengine.Session` / `Extension` / `Message` / `Join` (Slice 1); the module room routes from Task 5 (`POST /api/v1/telemedicine/appointments/:id/consult-session`) and Task 6 (`POST /api/finance/health/vet[.../provider]/appointments/:id/consult-session`); `@/api/client`; `@/utils/money`; `@/constants/tokens`.
- Produces:
  - `ConsultSession`, `ConsultJoin`, `ConsultExtension`, `ConsultMessage`, `ConsultOffer`, `ConsultMode`.
  - `serverOffsetMs(serverNow, receivedAtMs)`, `consultTimer(input, clientNowMs, offsetMs)`, `formatConsultClock(seconds)`.
  - `getConsultSession`, `joinConsultSession`, `completeConsultSession`, `listConsultExtensions`, `requestConsultExtension`, `decideConsultExtension`, `payConsultExtension`, `listConsultMessages`, `postConsultMessage`, `openTelemedicineConsultSession`, `openVetConsultSession`.
  - `normalizeConsultMode`, `offerFromDoctorPackage`, `offerFromVetPackage`.
  - `<PackagePicker offers selectedId onSelect />` and the module barrel.
  - npm script `test:consult`.

- [ ] **Step 1: Write the failing timer tests**

Create `mobile-app/reactnative/src/features/consult/__tests__/sessionTimer.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { consultTimer, formatConsultClock, serverOffsetMs } from '../sessionTimer.ts';

const at = (iso: string) => Date.parse(iso);

const base = {
  endsAt: '2026-11-04T10:30:00Z',
  warnAt: '2026-11-04T10:25:00Z',
  serverNow: '2026-11-04T10:20:00Z',
  state: 'live' as const,
  extendable: true,
};

test('counts down on the server clock, not the device clock', () => {
  // The device is five minutes slow. Trusting it would show 15 minutes left;
  // the session has 10.
  const deviceNow = at('2026-11-04T10:15:00Z');
  const offset = serverOffsetMs(base.serverNow, deviceNow);
  const timer = consultTimer(base, deviceNow, offset);
  assert.equal(timer.remainingSeconds, 600);
  assert.equal(timer.label, '10:00');
  assert.equal(timer.phase, 'ok');
  assert.equal(timer.canExtend, true);
});

test('projects elapsed time past the last poll with the captured offset', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  const timer = consultTimer(base, receivedAt + 90_000, offset);
  assert.equal(timer.remainingSeconds, 510); // 8m30s
  assert.equal(timer.phase, 'ok');
});

test('warning begins exactly at the server warn_at, not five minutes before ends_at', () => {
  const receivedAt = at('2026-11-04T10:24:59Z');
  const offset = serverOffsetMs(receivedAt.toISOString(), receivedAt);
  assert.equal(consultTimer(base, receivedAt, offset).phase, 'ok');
  assert.equal(consultTimer(base, receivedAt + 1_000, offset).phase, 'warning');
});

test('ends at 0:00 and stops offering an extension', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  const timer = consultTimer(base, at(base.endsAt), offset);
  assert.equal(timer.phase, 'expired');
  assert.equal(timer.remainingSeconds, 0);
  assert.equal(timer.label, '00:00');
  assert.equal(timer.canExtend, false);
});

test('an ended or cancelled session is expired even when its clock has time left', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  for (const state of ['ended', 'cancelled'] as const) {
    const timer = consultTimer({ ...base, state }, receivedAt, offset);
    assert.equal(timer.phase, 'expired', state);
    assert.equal(timer.canExtend, false, state);
  }
});

test('a session the server marks non-extendable never offers an extension', () => {
  const receivedAt = at('2026-11-04T10:20:00Z');
  const offset = serverOffsetMs(base.serverNow, receivedAt);
  assert.equal(consultTimer({ ...base, extendable: false }, receivedAt, offset).canExtend, false);
});

test('an unreadable ends_at fails closed instead of running media indefinitely', () => {
  const timer = consultTimer({ ...base, endsAt: 'not-a-date' }, at(base.serverNow), 0);
  assert.equal(timer.phase, 'expired');
  assert.equal(timer.canExtend, false);
});

test('formatConsultClock keeps mm:ss under an hour and adds hours above it', () => {
  assert.equal(formatConsultClock(0), '00:00');
  assert.equal(formatConsultClock(59), '00:59');
  assert.equal(formatConsultClock(600), '10:00');
  assert.equal(formatConsultClock(3661), '1:01:01');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
node --experimental-strip-types --test "src/features/consult/__tests__/sessionTimer.test.ts"
```
Expected: FAIL — `Cannot find module '../sessionTimer.ts'`.

- [ ] **Step 3: Write the wire types and offer mapping**

Create `mobile-app/reactnative/src/features/consult/types.ts`:

```ts
// Shared consult wire types. Mirrors backend/internal/health/consultengine:
// snake_case on the wire, the module screens keep that spelling so a mapped
// field cannot drift from the server's JSON.

export type ConsultVertical = 'telemedicine' | 'vet' | 'pharmacy' | 'lab';
export type ConsultMode = 'chat' | 'voice' | 'video';
export type ConsultState = 'scheduled' | 'live' | 'ended' | 'cancelled';

export type ExtensionStatus =
  | 'pending_approval'
  | 'approved_awaiting_payment'
  | 'paid'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface ConsultSession {
  id: string;
  vertical: ConsultVertical;
  mode: ConsultMode;
  patient_id: string;
  provider_user_id: string;
  source_ref: string;
  package_id?: string;
  duration_minutes: number;
  price_kobo: number;
  booked_start: string;
  ends_at: string;
  warn_at: string;
  warning_sent_at?: string;
  state: ConsultState;
  room_name: string;
  base_hold_id?: string;
  ended_at?: string;
  /** The engine's clock when this row was read. Anchors the client timer. */
  server_now: string;
  extendable: boolean;
  provider_owner_kind: 'doctor' | 'health_provider';
  provider_owner_id: string;
}

export interface ConsultRtc {
  provider: string;
  url: string;
  room: string;
}

export interface ConsultJoin {
  token: string;
  rtc: ConsultRtc;
  session: ConsultSession;
}

export interface ConsultExtension {
  id: string;
  session_id: string;
  requested_by: string;
  added_minutes: number;
  price_kobo: number;
  status: ExtensionStatus;
  approved_at?: string;
  payment_expires_at?: string;
  paid_at?: string;
  escrow_id?: string;
  decided_by?: string;
  decline_reason?: string;
  created_at: string;
}

export interface ConsultMessage {
  id: string;
  session_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/**
 * One price point as every picker renders it. Telemedicine's package quote is
 * snake_case and carries the platform fee in `booking.total_kobo`; the vet's
 * is camelCase and the package price is the whole charge. Both collapse here
 * so a screen never computes a fee of its own (ADR-044).
 */
export interface ConsultOffer {
  id: string;
  mode: ConsultMode;
  durationMinutes: number;
  priceKobo: number;
  totalKobo: number;
}

export const CONSULT_MODE_LABEL: Record<ConsultMode, string> = {
  video: 'Video',
  voice: 'Voice',
  chat: 'Chat',
};

/** The module UI says "audio" where the engine says "voice". */
export function normalizeConsultMode(raw: string): ConsultMode | null {
  const mode = raw.trim().toLowerCase();
  if (mode === 'video' || mode === 'voice' || mode === 'chat') return mode;
  if (mode === 'audio') return 'voice';
  return null;
}

export interface DoctorPackageWire {
  id: string;
  mode: string;
  duration_minutes: number;
  price_kobo: number;
  booking?: { total_kobo?: number; totalKobo?: number };
}

export interface VetPackageWire {
  id: string;
  mode: string;
  durationMinutes: number;
  priceKobo: number;
}

export function offerFromDoctorPackage(raw: DoctorPackageWire): ConsultOffer | null {
  const mode = normalizeConsultMode(raw.mode);
  if (!mode) return null;
  const total = raw.booking?.total_kobo ?? raw.booking?.totalKobo ?? 0;
  return {
    id: raw.id,
    mode,
    durationMinutes: raw.duration_minutes,
    priceKobo: raw.price_kobo,
    totalKobo: total > 0 ? total : raw.price_kobo,
  };
}

export function offerFromVetPackage(raw: VetPackageWire): ConsultOffer | null {
  const mode = normalizeConsultMode(raw.mode);
  if (!mode) return null;
  return {
    id: raw.id,
    mode,
    durationMinutes: raw.durationMinutes,
    priceKobo: raw.priceKobo,
    totalKobo: raw.priceKobo,
  };
}
```

- [ ] **Step 4: Write the timer**

Create `mobile-app/reactnative/src/features/consult/sessionTimer.ts`:

```ts
// Server-authoritative countdown. The device clock is only used to measure how
// long ago the last server reading arrived: the offset captured at that moment
// is added back on every tick, so a slow or fast phone cannot move the end.

export type TimerPhase = 'ok' | 'warning' | 'expired';

export interface TimerInput {
  endsAt: string;
  warnAt: string;
  state: 'scheduled' | 'live' | 'ended' | 'cancelled';
  extendable: boolean;
}

export interface ConsultTimer {
  phase: TimerPhase;
  warning: boolean;
  remainingSeconds: number;
  label: string;
  canExtend: boolean;
}

/** Server clock minus device clock, captured when a session payload arrived. */
export function serverOffsetMs(serverNow: string, receivedAtMs: number): number {
  const server = Date.parse(serverNow);
  return Number.isFinite(server) ? server - receivedAtMs : 0;
}

export function formatConsultClock(totalSeconds: number): string {
  const total = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function consultTimer(input: TimerInput, clientNowMs: number, offsetMs: number): ConsultTimer {
  const projected = clientNowMs + offsetMs;
  const ends = Date.parse(input.endsAt);
  const warn = Date.parse(input.warnAt);
  const ended = input.state === 'ended' || input.state === 'cancelled';
  // An unreadable end is not a licence to keep the camera running: the server
  // would have cut the room, so fail closed here too.
  const expired = ended || !Number.isFinite(ends) || projected >= ends;
  const warning = !expired && Number.isFinite(warn) && projected >= warn;
  const remainingSeconds = expired ? 0 : Math.max(0, Math.ceil((ends - projected) / 1000));
  const phase: TimerPhase = expired ? 'expired' : warning ? 'warning' : 'ok';
  return {
    phase,
    warning,
    remainingSeconds,
    label: formatConsultClock(remainingSeconds),
    canExtend: input.extendable && !expired,
  };
}
```

- [ ] **Step 5: Run the timer tests**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
node --experimental-strip-types --test "src/features/consult/__tests__/sessionTimer.test.ts"
```
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 6: Write the API client**

Create `mobile-app/reactnative/src/features/consult/api.ts`:

```ts
// HTTP for the shared consult engine plus the one module call each vertical
// owns: opening the session pinned to its appointment. The engine returns
// `{success, session}`; telemedicine wraps its open response in `{data}`; the
// vet returns `{success, session}`. `sessionOf` accepts all three envelopes.

import { api } from '@/api/client';
import type {
  ConsultExtension,
  ConsultJoin,
  ConsultMessage,
  ConsultRtc,
  ConsultSession,
} from './types';

const CONSULT_BASE = '/api/v1/consult';
const TELEMEDICINE_BASE = '/api/v1/telemedicine';
const VET_BASE = '/api/finance/health/vet';

function unwrapData(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

function sessionOf(body: unknown): ConsultSession {
  const value = unwrapData(body) as { session?: ConsultSession } | ConsultSession | null;
  const session = value && 'session' in value ? value.session : (value as ConsultSession | null);
  if (!session?.id) throw new Error('The consult response carried no session.');
  return session;
}

export async function getConsultSession(sessionId: string): Promise<ConsultSession> {
  const { data } = await api.get(`${CONSULT_BASE}/sessions/${sessionId}`);
  return sessionOf(data);
}

export async function joinConsultSession(sessionId: string): Promise<ConsultJoin> {
  const { data } = await api.post<{
    success?: boolean;
    token?: string;
    rtc?: ConsultRtc;
    session?: ConsultSession;
  }>(`${CONSULT_BASE}/sessions/${sessionId}/join`, {});
  if (!data?.token || !data.rtc || !data.session) {
    throw new Error('The consult join response was incomplete.');
  }
  return { token: data.token, rtc: data.rtc, session: data.session };
}

export async function completeConsultSession(sessionId: string): Promise<void> {
  await api.post(`${CONSULT_BASE}/sessions/${sessionId}/complete`, {});
}

export async function listConsultExtensions(sessionId: string): Promise<ConsultExtension[]> {
  const { data } = await api.get<{ success?: boolean; extensions?: ConsultExtension[] }>(
    `${CONSULT_BASE}/sessions/${sessionId}/extensions`,
  );
  return data?.extensions ?? [];
}

export async function requestConsultExtension(sessionId: string, addedMinutes: number): Promise<ConsultExtension> {
  const { data } = await api.post<{ extension?: ConsultExtension; error?: string }>(
    `${CONSULT_BASE}/sessions/${sessionId}/extensions`,
    { added_minutes: addedMinutes },
  );
  if (!data?.extension) throw new Error(data?.error ?? 'The extension request was not accepted.');
  return data.extension;
}

export async function decideConsultExtension(
  sessionId: string,
  extensionId: string,
  approve: boolean,
  reason?: string,
): Promise<ConsultExtension> {
  const { data } = await api.post<{ extension?: ConsultExtension; error?: string }>(
    `${CONSULT_BASE}/sessions/${sessionId}/extensions/${extensionId}/decide`,
    { approve, reason: reason ?? '' },
  );
  if (!data?.extension) throw new Error(data?.error ?? 'The extension decision was not accepted.');
  return data.extension;
}

export async function payConsultExtension(
  sessionId: string,
  extensionId: string,
): Promise<{ extension: ConsultExtension; session: ConsultSession }> {
  const { data } = await api.post<{
    extension?: ConsultExtension;
    session?: ConsultSession;
    error?: string;
  }>(`${CONSULT_BASE}/sessions/${sessionId}/extensions/${extensionId}/pay`, {});
  if (!data?.extension || !data.session) {
    throw new Error(data?.error ?? 'The extension payment was not accepted.');
  }
  return { extension: data.extension, session: data.session };
}

export async function listConsultMessages(sessionId: string, after?: string): Promise<ConsultMessage[]> {
  const { data } = await api.get<{ success?: boolean; messages?: ConsultMessage[] }>(
    `${CONSULT_BASE}/sessions/${sessionId}/messages`,
    { params: after ? { after } : undefined },
  );
  return data?.messages ?? [];
}

export async function postConsultMessage(sessionId: string, body: string): Promise<ConsultMessage> {
  const { data } = await api.post<{ message?: ConsultMessage; error?: string }>(
    `${CONSULT_BASE}/sessions/${sessionId}/messages`,
    { body },
  );
  if (!data?.message) throw new Error(data?.error ?? 'Your message could not be sent.');
  return data.message;
}

/**
 * Open (or re-open) the one session pinned to this telemedicine appointment.
 * Idempotent server-side: a retry returns the same session.
 */
export async function openTelemedicineConsultSession(appointmentId: string): Promise<ConsultSession> {
  const { data } = await api.post(
    `${TELEMEDICINE_BASE}/appointments/${appointmentId}/consult-session`,
    {},
  );
  return sessionOf(data);
}

/**
 * Open the vet appointment's session as the pet owner (`asProvider=false`) or
 * as the vet (`asProvider=true`). Both hit the same engine and return the row.
 */
export async function openVetConsultSession(appointmentId: string, asProvider = false): Promise<ConsultSession> {
  const path = asProvider
    ? `${VET_BASE}/provider/appointments/${appointmentId}/consult-session`
    : `${VET_BASE}/appointments/${appointmentId}/consult-session`;
  const { data } = await api.post(path, {});
  return sessionOf(data);
}
```

- [ ] **Step 7: Write the shared package picker**

Create `mobile-app/reactnative/src/features/consult/PackagePicker.tsx`:

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MessageCircle, Phone, Video } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { CONSULT_MODE_LABEL, type ConsultMode, type ConsultOffer } from './types';

const MODE_ICON: Record<ConsultMode, typeof Video> = {
  video: Video,
  voice: Phone,
  chat: MessageCircle,
};

export interface PackagePickerProps {
  offers: ConsultOffer[];
  selectedId: string | null;
  onSelect: (offer: ConsultOffer) => void;
}

/**
 * The one price-point selector both modules use. It renders only amounts the
 * server sent in the package quote; it never adds a fee of its own.
 */
export default function PackagePicker({ offers, selectedId, onSelect }: PackagePickerProps) {
  if (offers.length === 0) return null;
  return (
    <View style={styles.grid}>
      {offers.map((offer) => {
        const Icon = MODE_ICON[offer.mode];
        const selected = offer.id === selectedId;
        return (
          <Pressable
            key={offer.id}
            onPress={() => onSelect(offer)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.card, selected && styles.cardSelected]}
          >
            <View style={styles.head}>
              <Icon size={18} color={selected ? Colors.secondary : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.mode, selected && styles.modeSelected]}>{CONSULT_MODE_LABEL[offer.mode]}</Text>
            </View>
            <Text style={styles.duration}>{offer.durationMinutes} min</Text>
            <Text style={[styles.price, selected && styles.priceSelected]}>
              {formatNaira(offer.totalKobo, { decimals: false })}
            </Text>
            <Text style={styles.caption}>Payable now</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  card: {
    minWidth: 128,
    flexGrow: 1,
    gap: 2,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  cardSelected: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mode: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  modeSelected: { color: Colors.secondary },
  duration: { ...Typography.titleMd, color: Colors.onSurface },
  price: { ...Typography.bodyMd, color: Colors.onSurface },
  priceSelected: { color: Colors.primary, fontWeight: '800' },
  caption: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
```

- [ ] **Step 8: Add the barrel and the test script**

Create `mobile-app/reactnative/src/features/consult/index.ts`:

```ts
export * from './types';
export * from './sessionTimer';
export * from './api';
export { default as PackagePicker } from './PackagePicker';
```

In `mobile-app/reactnative/package.json`, add after the `"test:vet-pet"` line:

```json
    "test:consult": "node --experimental-strip-types --test \"src/features/consult/__tests__/*.test.ts\"",
```

- [ ] **Step 9: Run the task's tests and typecheck**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:consult
npm run typecheck
```
Expected: 8 timer tests PASS, then `tsc --noEmit` exits 0 with no output.

- [ ] **Step 10: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add mobile-app/reactnative/src/features/consult/types.ts \
        mobile-app/reactnative/src/features/consult/sessionTimer.ts \
        mobile-app/reactnative/src/features/consult/__tests__/sessionTimer.test.ts \
        mobile-app/reactnative/src/features/consult/api.ts \
        mobile-app/reactnative/src/features/consult/PackagePicker.tsx \
        mobile-app/reactnative/src/features/consult/index.ts \
        mobile-app/reactnative/package.json
git commit -m "feat(consult): shared mobile consult types, server-clock timer and API client"
```

### Task 9: Mobile consult data hooks and platform media

The room needs two independent loops: HTTP polling for the session, extensions
and chat, and one LiveKit connection for voice/video. Keeping them apart means
a chat consult never opens a media room, and media can be cut at 0:00 while the
polling hooks keep the ended state authoritative.

**Files:**
- Modify: `mobile-app/reactnative/src/features/consult/types.ts` (media state types)
- Create: `mobile-app/reactnative/src/features/consult/hooks.ts`
- Create: `mobile-app/reactnative/src/features/consult/useConsultMedia.ts`
- Create: `mobile-app/reactnative/src/features/consult/useConsultMedia.native.ts`
- Create: `mobile-app/reactnative/src/features/consult/ConsultVideo.tsx`
- Create: `mobile-app/reactnative/src/features/consult/ConsultVideo.native.tsx`
- Modify: `mobile-app/reactnative/src/features/consult/index.ts` (export the new modules)

**Interfaces:**
- Consumes: Task 8's `api.ts`, `types.ts`, `consultTimer`; `@/features/academy/live/connection` (`parseConnection`, `describeConnectionFailure`); React Query v5; `livekit-client`; `@livekit/react-native`.
- Produces:
  - `useConsultSession`, `useConsultExtensions`, `useConsultMessages`, `useConsultJoin`, `useSendConsultMessage`, `useRequestConsultExtension`, `useDecideConsultExtension`, `usePayConsultExtension`.
  - `useConsultMedia(join, mode, live): ConsultMedia`, with `.native.ts` using `registerGlobals`/`AudioSession`.
  - `<ConsultVideo publication label mirrored muted />` with `.native.tsx` using `VideoTrack`.
  - `ConsultMediaState` / `ConsultMedia` exported from `types.ts`.

- [ ] **Step 1: Add the media types**

In `mobile-app/reactnative/src/features/consult/types.ts`, add at the bottom:

```ts
import type { TrackPublication } from 'livekit-client';

export type ConsultMediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * `localVideo` / `remoteVideo` stay opaque to the room: web attaches
 * `publication.track` to a <video>, native hands the publication to <VideoTrack>.
 */
export interface ConsultMediaState {
  status: ConsultMediaStatus;
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  localVideo: TrackPublication | null;
  remoteVideo: TrackPublication | null;
}

export interface ConsultMedia extends ConsultMediaState {
  setMic: (on: boolean) => Promise<void>;
  setCam: (on: boolean) => Promise<void>;
}
```

- [ ] **Step 2: Write the React Query hooks**

Create `mobile-app/reactnative/src/features/consult/hooks.ts`:

```ts
// Polling and mutations for one consult session. React Query v5.
//
// The session poll is the source of truth for the timer and the ended state;
// chat polls on a shorter interval because it is the whole product in chat
// mode. Everything stops once the session is ended or cancelled.

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  decideConsultExtension,
  getConsultSession,
  joinConsultSession,
  listConsultExtensions,
  listConsultMessages,
  payConsultExtension,
  postConsultMessage,
  requestConsultExtension,
} from './api';

export const CONSULT_POLL_MS = 15_000;
export const CONSULT_MESSAGE_POLL_MS = 5_000;

const KEYS = {
  session: (id: string) => ['consult', 'session', id] as const,
  extensions: (id: string) => ['consult', 'extensions', id] as const,
  messages: (id: string) => ['consult', 'messages', id] as const,
};

export function useConsultSession(sessionId?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEYS.session(sessionId ?? ''),
    queryFn: () => getConsultSession(sessionId as string),
    enabled: Boolean(sessionId),
    staleTime: 0,
    refetchInterval: (q) => {
      const session = q.state.data;
      return session && (session.state === 'ended' || session.state === 'cancelled') ? false : CONSULT_POLL_MS;
    },
  });

  // A phone that was asleep resumes with a stale countdown; read the server
  // again the moment the app is foregrounded.
  useEffect(() => {
    if (!sessionId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void qc.invalidateQueries({ queryKey: KEYS.session(sessionId) });
    });
    return () => sub.remove();
  }, [qc, sessionId]);

  return query;
}

export function useConsultExtensions(sessionId?: string, enabled = true) {
  return useQuery({
    queryKey: KEYS.extensions(sessionId ?? ''),
    queryFn: () => listConsultExtensions(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
    staleTime: 0,
    refetchInterval: enabled ? CONSULT_POLL_MS : false,
  });
}

export function useConsultMessages(sessionId?: string, enabled = true) {
  return useQuery({
    queryKey: KEYS.messages(sessionId ?? ''),
    queryFn: () => listConsultMessages(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
    staleTime: 0,
    refetchInterval: enabled ? CONSULT_MESSAGE_POLL_MS : false,
  });
}

/** A fresh LiveKit token for the session. Call again to rejoin after a drop. */
export function useConsultJoin(sessionId?: string) {
  return useMutation({
    mutationFn: () => joinConsultSession(sessionId as string),
  });
}

export function useSendConsultMessage(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => postConsultMessage(sessionId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.messages(sessionId ?? '') }),
  });
}

export function useRequestConsultExtension(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number) => requestConsultExtension(sessionId as string, minutes),
    onSuccess: () => {
      // A provider's extension is granted immediately and moves `ends_at`.
      qc.invalidateQueries({ queryKey: KEYS.extensions(sessionId ?? '') });
      qc.invalidateQueries({ queryKey: KEYS.session(sessionId ?? '') });
    },
  });
}

export function useDecideConsultExtension(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { extensionId: string; approve: boolean; reason?: string }) =>
      decideConsultExtension(sessionId as string, input.extensionId, input.approve, input.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.extensions(sessionId ?? '') });
      qc.invalidateQueries({ queryKey: KEYS.session(sessionId ?? '') });
    },
  });
}

export function usePayConsultExtension(sessionId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (extensionId: string) => payConsultExtension(sessionId as string, extensionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.extensions(sessionId ?? '') });
      qc.invalidateQueries({ queryKey: KEYS.session(sessionId ?? '') });
    },
  });
}
```

- [ ] **Step 3: Write the web media hook**

Create `mobile-app/reactnative/src/features/consult/useConsultMedia.ts`:

```ts
// Web room. Expo web runs the same app in a browser, where livekit-client owns
// the RTCPeerConnection directly. Native loads useConsultMedia.native.ts.
//
// Connection validation is NOT duplicated: parseConnection refuses a response
// that is not a LiveKit JWT + wss URL, the same gate the Academy live room uses.

import { useEffect, useRef, useState } from 'react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import type { TrackPublication } from 'livekit-client';

import { describeConnectionFailure, parseConnection } from '@/features/academy/live/connection';
import type { ConsultJoin, ConsultMedia, ConsultMediaState, ConsultMode } from './types';

const idle: ConsultMediaState = {
  status: 'idle',
  error: null,
  micOn: false,
  camOn: false,
  localVideo: null,
  remoteVideo: null,
};

function pickVideo(room: Room): Pick<ConsultMediaState, 'localVideo' | 'remoteVideo'> {
  const localVideo = room.localParticipant.getTrackPublication(Track.Source.Camera) ?? null;
  let remoteVideo: TrackPublication | null = null;
  for (const participant of room.remoteParticipants.values()) {
    const publication = participant.getTrackPublication(Track.Source.Camera);
    if (publication?.track && !publication.isMuted) {
      remoteVideo = publication;
      break;
    }
  }
  return { localVideo, remoteVideo };
}

export function useConsultMedia(join: ConsultJoin | null, mode: ConsultMode, live: boolean): ConsultMedia {
  const [state, setState] = useState<ConsultMediaState>(idle);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!join || !live || mode === 'chat') {
      setState(idle);
      return;
    }
    const parsed = parseConnection({ token: join.token, rtc: join.rtc }, { allowInsecure: __DEV__ });
    if (!parsed.ok) {
      setState({ ...idle, status: 'failed', error: describeConnectionFailure(parsed.reason) });
      return;
    }

    let disposed = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setState({ ...idle, status: 'connecting' });

    const patch = (next: Partial<ConsultMediaState>) => {
      if (!disposed) setState((current) => ({ ...current, ...next }));
    };
    const refresh = () => {
      if (disposed) return;
      const local = room.localParticipant;
      patch({
        ...pickVideo(room),
        micOn: local.isMicrophoneEnabled,
        camOn: local.isCameraEnabled,
      });
    };

    room
      .on(RoomEvent.ConnectionStateChanged, (next: ConnectionState) => {
        if (next === ConnectionState.Connected) {
          patch({ status: 'connected' });
          refresh();
        } else if (next === ConnectionState.Connecting) {
          patch({ status: 'connecting' });
        } else if (next === ConnectionState.Reconnecting || next === ConnectionState.SignalReconnecting) {
          patch({ status: 'reconnecting' });
        }
      })
      .on(RoomEvent.Disconnected, () => patch({ status: 'failed', error: 'The consult connection ended. Rejoin to continue.' }))
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ParticipantPermissionsChanged, refresh)
      .on(RoomEvent.MediaDevicesError, (e: Error) =>
        patch({ error: e?.message || 'Camera or microphone is unavailable.' }));

    void (async () => {
      try {
        await room.connect(parsed.connection.url, parsed.connection.token, { autoSubscribe: true });
        if (disposed) {
          await room.disconnect();
          return;
        }
        if (mode === 'video') await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (disposed) return;
        setState((current) => ({
          ...current,
          status: 'connected',
          ...pickVideo(room),
          micOn: room.localParticipant.isMicrophoneEnabled,
          camOn: room.localParticipant.isCameraEnabled,
        }));
      } catch (e) {
        patch({ status: 'failed', error: e instanceof Error ? e.message : 'Could not connect to the consult.' });
      }
    })();

    return () => {
      disposed = true;
      room.removeAllListeners();
      void room.disconnect();
      roomRef.current = null;
    };
  }, [join, live, mode]);

  const setMic = async (on: boolean) => {
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(on);
    } catch (e) {
      setState((current) => ({ ...current, error: e instanceof Error ? e.message : 'Microphone permission was denied.' }));
    }
    setState((current) => ({ ...current, micOn: roomRef.current?.localParticipant.isMicrophoneEnabled ?? false }));
  };

  const setCam = async (on: boolean) => {
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(on);
    } catch (e) {
      setState((current) => ({ ...current, error: e instanceof Error ? e.message : 'Camera permission was denied.' }));
    }
    const room = roomRef.current;
    setState((current) => ({
      ...current,
      camOn: room?.localParticipant.isCameraEnabled ?? false,
      ...(room ? pickVideo(room) : {}),
    }));
  };

  return { ...state, setMic, setCam };
}
```

- [ ] **Step 4: Write the native media hook**

Create `mobile-app/reactnative/src/features/consult/useConsultMedia.native.ts`:

```ts
// iOS / Android room. The SDK setup is confined to this file and
// ConsultVideo.native.tsx; the screens and the web bundle never import it.

import { useEffect, useRef, useState } from 'react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import type { TrackPublication } from 'livekit-client';
import { AudioSession, registerGlobals } from '@livekit/react-native';

import { describeConnectionFailure, parseConnection } from '@/features/academy/live/connection';
import type { ConsultJoin, ConsultMedia, ConsultMediaState, ConsultMode } from './types';

let globalsRegistered = false;
function ensureGlobals() {
  if (!globalsRegistered) {
    registerGlobals();
    globalsRegistered = true;
  }
}

// The audio session is process-wide. Serialise start/stop so a leaving room's
// stop cannot silence the next room's start.
let audioChain: Promise<unknown> = Promise.resolve();
const startAudio = () =>
  (audioChain = audioChain.catch(() => undefined).then(() => AudioSession.startAudioSession())) as Promise<void>;
const stopAudio = () =>
  (audioChain = audioChain.catch(() => undefined).then(() => AudioSession.stopAudioSession())) as Promise<void>;

const idle: ConsultMediaState = {
  status: 'idle',
  error: null,
  micOn: false,
  camOn: false,
  localVideo: null,
  remoteVideo: null,
};

function pickVideo(room: Room): Pick<ConsultMediaState, 'localVideo' | 'remoteVideo'> {
  const localVideo = room.localParticipant.getTrackPublication(Track.Source.Camera) ?? null;
  let remoteVideo: TrackPublication | null = null;
  for (const participant of room.remoteParticipants.values()) {
    const publication = participant.getTrackPublication(Track.Source.Camera);
    if (publication?.track && !publication.isMuted) {
      remoteVideo = publication;
      break;
    }
  }
  return { localVideo, remoteVideo };
}

export function useConsultMedia(join: ConsultJoin | null, mode: ConsultMode, live: boolean): ConsultMedia {
  const [state, setState] = useState<ConsultMediaState>(idle);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!join || !live || mode === 'chat') {
      setState(idle);
      return;
    }
    const parsed = parseConnection({ token: join.token, rtc: join.rtc }, { allowInsecure: __DEV__ });
    if (!parsed.ok) {
      setState({ ...idle, status: 'failed', error: describeConnectionFailure(parsed.reason) });
      return;
    }

    ensureGlobals();
    let disposed = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setState({ ...idle, status: 'connecting' });

    const patch = (next: Partial<ConsultMediaState>) => {
      if (!disposed) setState((current) => ({ ...current, ...next }));
    };
    const refresh = () => {
      if (disposed) return;
      const local = room.localParticipant;
      patch({
        ...pickVideo(room),
        micOn: local.isMicrophoneEnabled,
        camOn: local.isCameraEnabled,
      });
    };

    room
      .on(RoomEvent.ConnectionStateChanged, (next: ConnectionState) => {
        if (next === ConnectionState.Connected) {
          patch({ status: 'connected' });
          refresh();
        } else if (next === ConnectionState.Connecting) {
          patch({ status: 'connecting' });
        } else if (next === ConnectionState.Reconnecting || next === ConnectionState.SignalReconnecting) {
          patch({ status: 'reconnecting' });
        }
      })
      .on(RoomEvent.Disconnected, () => patch({ status: 'failed', error: 'The consult connection ended. Rejoin to continue.' }))
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ParticipantPermissionsChanged, refresh)
      .on(RoomEvent.MediaDevicesError, (e: Error) =>
        patch({ error: e?.message || 'Camera or microphone is unavailable.' }));

    void (async () => {
      try {
        await startAudio();
        await room.connect(parsed.connection.url, parsed.connection.token, { autoSubscribe: true });
        if (disposed) {
          await room.disconnect();
          return;
        }
        if (mode === 'video') await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (disposed) return;
        setState((current) => ({
          ...current,
          status: 'connected',
          ...pickVideo(room),
          micOn: room.localParticipant.isMicrophoneEnabled,
          camOn: room.localParticipant.isCameraEnabled,
        }));
      } catch (e) {
        patch({ status: 'failed', error: e instanceof Error ? e.message : 'Could not connect to the consult.' });
      }
    })();

    return () => {
      disposed = true;
      room.removeAllListeners();
      void room.disconnect();
      void stopAudio();
      roomRef.current = null;
    };
  }, [join, live, mode]);

  const setMic = async (on: boolean) => {
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(on);
    } catch (e) {
      setState((current) => ({ ...current, error: e instanceof Error ? e.message : 'Microphone permission was denied.' }));
    }
    setState((current) => ({ ...current, micOn: roomRef.current?.localParticipant.isMicrophoneEnabled ?? false }));
  };

  const setCam = async (on: boolean) => {
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(on);
    } catch (e) {
      setState((current) => ({ ...current, error: e instanceof Error ? e.message : 'Camera permission was denied.' }));
    }
    const room = roomRef.current;
    setState((current) => ({
      ...current,
      camOn: room?.localParticipant.isCameraEnabled ?? false,
      ...(room ? pickVideo(room) : {}),
    }));
  };

  return { ...state, setMic, setCam };
}
```

- [ ] **Step 5: Write the two video renderers**

Create `mobile-app/reactnative/src/features/consult/ConsultVideo.tsx`:

```tsx
// Web video element for one consult publication. `track.attach` binds the
// WebRTC MediaStream; `detach` releases it when the publication changes.

import React, { useEffect, useRef } from 'react';

export interface ConsultVideoProps {
  publication: unknown;
  label: string;
  mirrored?: boolean;
  muted?: boolean;
}

interface AttachableTrack {
  attach(el: HTMLVideoElement): HTMLVideoElement;
  detach(el?: HTMLVideoElement): void;
}

export default function ConsultVideo({ publication, label, mirrored = false, muted = false }: ConsultVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const track = (publication as { track?: AttachableTrack } | null)?.track;
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [publication]);

  if (!publication) {
    return React.createElement('div', { style: styles.empty }, label);
  }
  return React.createElement('video', {
    ref,
    autoPlay: true,
    playsInline: true,
    muted,
    style: { ...styles.video, transform: mirrored ? 'scaleX(-1)' : undefined },
  });
}

const styles = {
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
    borderRadius: 12,
    backgroundColor: '#000',
  },
  empty: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#d8d2e8',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#1f1b2d',
    borderRadius: 12,
  },
};
```

Create `mobile-app/reactnative/src/features/consult/ConsultVideo.native.tsx`:

```tsx
// Native video for one consult publication. VideoTrack takes the publication
// (a TrackReference), which is exactly what the media hook stores.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VideoTrack } from '@livekit/react-native';

type TrackRef = React.ComponentProps<typeof VideoTrack>['trackRef'];

export interface ConsultVideoProps {
  publication: unknown;
  label: string;
  mirrored?: boolean;
  muted?: boolean;
}

export default function ConsultVideo({ publication, label, mirrored = false }: ConsultVideoProps) {
  const trackRef = publication as TrackRef | null;
  if (!trackRef) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{label}</Text>
      </View>
    );
  }
  return <VideoTrack trackRef={trackRef} style={styles.video} objectFit="cover" mirror={mirrored} />;
}

const styles = StyleSheet.create({
  video: { width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  empty: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    backgroundColor: '#1f1b2d',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  emptyText: { color: '#d8d2e8', textAlign: 'center' },
});
```

- [ ] **Step 6: Export the new modules**

Replace `mobile-app/reactnative/src/features/consult/index.ts` with:

```ts
export * from './types';
export * from './sessionTimer';
export * from './api';
export * from './hooks';
export { default as PackagePicker } from './PackagePicker';
export { default as ConsultVideo } from './ConsultVideo';
export { useConsultMedia } from './useConsultMedia';
```

- [ ] **Step 7: Typecheck**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:consult
npm run typecheck
```
Expected: the 8 timer tests PASS; `tsc --noEmit` exits 0.

- [ ] **Step 8: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add mobile-app/reactnative/src/features/consult/types.ts \
        mobile-app/reactnative/src/features/consult/hooks.ts \
        mobile-app/reactnative/src/features/consult/useConsultMedia.ts \
        mobile-app/reactnative/src/features/consult/useConsultMedia.native.ts \
        mobile-app/reactnative/src/features/consult/ConsultVideo.tsx \
        mobile-app/reactnative/src/features/consult/ConsultVideo.native.tsx \
        mobile-app/reactnative/src/features/consult/index.ts
git commit -m "feat(consult): polling hooks and platform LiveKit media"
```

### Task 10: Shared consult room and extension sheet

**Files:**
- Create: `mobile-app/reactnative/src/features/consult/roomView.ts`
- Create: `mobile-app/reactnative/src/features/consult/__tests__/roomView.test.ts`
- Create: `mobile-app/reactnative/src/features/consult/ExtensionSheet.tsx`
- Create: `mobile-app/reactnative/src/features/consult/ConsultRoom.tsx`
- Modify: `mobile-app/reactnative/src/features/consult/index.ts`

**Interfaces:**
- Consumes: `ConsultSession`, `ConsultExtension`, `ConsultMessage`, `CONSULT_MODE_LABEL`, `ConsultViewer` from `./types`; `consultTimer(..)`, `serverOffsetMs(..)`, `formatConsultClock(..)` from `./sessionTimer`; the Task 9 hooks (`useConsultSession`, `useConsultExtensions`, `useConsultMessages`, `useConsultJoin`, `useSendConsultMessage`, `useRequestConsultExtension`, `useDecideConsultExtension`, `usePayConsultExtension`), `useConsultMedia`, `ConsultVideo`, and `completeConsultSession` from `./api`.
- Consumes shared checkout: `usePurchasePayment<T>()` returns `{ start(req), ... }`; `start` accepts `{ amountKobo, title?, charge(method, pin?) => Promise<T>, method?, domain? }`. `PaymentSheet` renders the wallets/card flow. Pass `method: 'wallet'` — `PayExtension` debits the wallet server-side, so the card rail would only add a needless top-up step.
- Produces (used by Tasks 11 and 12):
  - `ConsultRoom({ sessionId, role, onEnd?, onBack? })` — a full-screen room. `role` is `'patient' | 'provider'`; `onEnd` replaces the default engine `Complete` call, so a module can finish its own appointment row first (telemedicine/vet provider routes).
  - `ExtensionSheet` — the request/approve/decline/pay bottom sheet.
  - `viewerOf(session, userId)`, `canJoinNow(session, projectedNowMs)`, `openExtension(extensions)`, `extensionAction(ext, viewer, projectedNowMs)`, `maxExtensionMinutes(session)` from `./roomView`.

- [ ] **Step 1: Write the failing tests for room view rules**

Create `mobile-app/reactnative/src/features/consult/__tests__/roomView.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canJoinNow,
  extensionAction,
  maxExtensionMinutes,
  openExtension,
  viewerOf,
} from '../roomView.ts';
import type { ConsultExtension, ConsultSession } from '../types.ts';

const START = Date.parse('2026-11-04T10:00:00.000Z');
const MIN = 60_000;

function session(over: Partial<ConsultSession> = {}): ConsultSession {
  return {
    id: 'sess-1',
    vertical: 'telemedicine',
    mode: 'video',
    patient_id: 'patient-1',
    provider_user_id: 'doctor-1',
    source_ref: 'appointment-1',
    duration_minutes: 30,
    price_kobo: 200_000,
    booked_start: new Date(START).toISOString(),
    ends_at: new Date(START + 30 * MIN).toISOString(),
    warn_at: new Date(START + 25 * MIN).toISOString(),
    state: 'scheduled',
    room_name: 'consult-sess-1',
    server_now: new Date(START).toISOString(),
    extendable: true,
    provider_owner_kind: 'doctor',
    provider_owner_id: 'doctor-1',
    ...over,
  };
}

function extension(over: Partial<ConsultExtension> = {}): ConsultExtension {
  return {
    id: 'ext-1',
    session_id: 'sess-1',
    requested_by: 'patient-1',
    added_minutes: 15,
    price_kobo: 100_000,
    status: 'pending_approval',
    created_at: new Date(START).toISOString(),
    ...over,
  };
}

test('viewerOf distinguishes the patient, the provider and everyone else', () => {
  const s = session();
  assert.equal(viewerOf(s, 'patient-1'), 'patient');
  assert.equal(viewerOf(s, 'doctor-1'), 'provider');
  assert.equal(viewerOf(s, 'stranger'), 'observer');
  assert.equal(viewerOf(s, undefined), 'observer');
});

test('canJoinNow opens ten minutes before the booked start, never after the end', () => {
  const s = session();
  assert.equal(canJoinNow(s, START - 11 * MIN), false);
  assert.equal(canJoinNow(s, START - 10 * MIN), true);
  assert.equal(canJoinNow(s, START + MIN), true);
  assert.equal(canJoinNow({ ...s, state: 'live' }, START - 20 * MIN), true);
  assert.equal(canJoinNow(s, START + 30 * MIN), false);
  assert.equal(canJoinNow({ ...s, state: 'ended' }, START + MIN), false);
  assert.equal(canJoinNow({ ...s, state: 'cancelled' }, START + MIN), false);
});

test('openExtension returns only requests still awaiting the other side', () => {
  const closed = [
    extension({ id: 'a', status: 'paid' }),
    extension({ id: 'b', status: 'declined' }),
    extension({ id: 'c', status: 'expired' }),
  ];
  assert.equal(openExtension(closed), undefined);
  const pending = extension({ id: 'd', status: 'pending_approval' });
  assert.equal(openExtension([...closed, pending])?.id, 'd');
});

test('a pending request asks the provider to review and the patient to wait', () => {
  const ext = extension();
  assert.deepEqual(extensionAction(ext, 'provider', START), {
    kind: 'approve',
    label: 'Review request',
    extensionId: 'ext-1',
  });
  assert.equal(extensionAction(ext, 'patient', START).kind, 'wait');
});

test('an approved request asks the patient to pay its price and the provider to wait', () => {
  const ext = extension({
    status: 'approved_awaiting_payment',
    approved_at: new Date(START).toISOString(),
    payment_expires_at: new Date(START + 5 * MIN).toISOString(),
  });
  assert.deepEqual(extensionAction(ext, 'patient', START + MIN), {
    kind: 'pay',
    label: 'Pay to extend',
    extensionId: 'ext-1',
    amountKobo: 100_000,
  });
  assert.equal(extensionAction(ext, 'provider', START + MIN).kind, 'wait');
});

test('an approval past its payment window is closed, not payable', () => {
  const ext = extension({
    status: 'approved_awaiting_payment',
    payment_expires_at: new Date(START + 5 * MIN).toISOString(),
  });
  const action = extensionAction(ext, 'patient', START + 5 * MIN);
  assert.equal(action.kind, 'closed');
  assert.equal(action.amountKobo, undefined);
});

test('paid and declined requests resolve without asking either side to act', () => {
  const paid = extension({ status: 'paid', price_kobo: 0 });
  assert.deepEqual(extensionAction(paid, 'patient', START), {
    kind: 'none',
    label: 'Extended by 15 min',
    extensionId: 'ext-1',
  });
  assert.equal(extensionAction(extension({ status: 'declined' }), 'patient', START).kind, 'request');
  assert.equal(extensionAction(undefined, 'patient', START).kind, 'request');
  assert.equal(extensionAction(extension(), 'observer', START).kind, 'none');
});

test('maxExtensionMinutes honours the four-hour ceiling and the 240-minute cap', () => {
  assert.equal(maxExtensionMinutes(session()), 210);
  assert.equal(
    maxExtensionMinutes(session({ ends_at: new Date(START + 270 * MIN).toISOString() })),
    30,
  );
  assert.equal(
    maxExtensionMinutes(session({ ends_at: new Date(START + 300 * MIN).toISOString() })),
    0,
  );
  assert.equal(maxExtensionMinutes(session({ ends_at: 'not-a-date' })), 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
node --experimental-strip-types --test "src/features/consult/__tests__/roomView.test.ts"
```
Expected: FAIL — `Cannot find module '../roomView.ts'`.

- [ ] **Step 3: Implement the room view rules**

Create `mobile-app/reactnative/src/features/consult/roomView.ts`:

```ts
// Display rules for one consult session. Pure functions, no React and no
// imports outside this folder, so the node test runner can load this file
// without the app's `@/` alias.

import type { ConsultExtension, ConsultSession } from './types';

export type ConsultViewer = 'patient' | 'provider' | 'observer';

/** The room opens this long before the booked start, the same window the server allows. */
export const EARLY_JOIN_MS = 10 * 60 * 1000;

/** Mirrors consultengine.MaxExtensionMinutes and MaxSessionWindow. */
export const MAX_EXTENSION_MINUTES = 240;
export const MAX_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

export function viewerOf(
  session: Pick<ConsultSession, 'patient_id' | 'provider_user_id'>,
  userId?: string | null,
): ConsultViewer {
  if (!userId) return 'observer';
  if (userId === session.patient_id) return 'patient';
  if (userId === session.provider_user_id) return 'provider';
  return 'observer';
}

/** `projectedNowMs` must already include the server-clock offset (serverOffsetMs). */
export function canJoinNow(
  session: Pick<ConsultSession, 'state' | 'booked_start' | 'ends_at'>,
  projectedNowMs: number,
): boolean {
  if (session.state === 'ended' || session.state === 'cancelled') return false;
  const ends = Date.parse(session.ends_at);
  if (Number.isFinite(ends) && projectedNowMs >= ends) return false;
  if (session.state === 'live') return true;
  const start = Date.parse(session.booked_start);
  if (!Number.isFinite(start)) return false;
  return projectedNowMs + EARLY_JOIN_MS >= start;
}

export function openExtension(extensions: ConsultExtension[] | undefined): ConsultExtension | undefined {
  return extensions?.find(
    (ext) => ext.status === 'pending_approval' || ext.status === 'approved_awaiting_payment',
  );
}

export type ExtensionActionKind = 'request' | 'approve' | 'pay' | 'wait' | 'closed' | 'none';

export interface ExtensionAction {
  kind: ExtensionActionKind;
  label: string;
  extensionId?: string;
  amountKobo?: number;
}

/**
 * What the current viewer can do about the one open extension, if any.
 * The server re-checks all of it — this only decides which control to show.
 */
export function extensionAction(
  ext: ConsultExtension | undefined,
  viewer: ConsultViewer,
  projectedNowMs: number,
): ExtensionAction {
  if (viewer === 'observer') return { kind: 'none', label: '' };
  if (!ext) return { kind: 'request', label: 'Extend session' };
  switch (ext.status) {
    case 'pending_approval':
      return viewer === 'provider'
        ? { kind: 'approve', label: 'Review request', extensionId: ext.id }
        : { kind: 'wait', label: 'Waiting for provider approval', extensionId: ext.id };
    case 'approved_awaiting_payment': {
      const expires = ext.payment_expires_at ? Date.parse(ext.payment_expires_at) : NaN;
      if (!Number.isFinite(expires) || projectedNowMs >= expires) {
        return { kind: 'closed', label: 'Approval expired', extensionId: ext.id };
      }
      return viewer === 'patient'
        ? { kind: 'pay', label: 'Pay to extend', extensionId: ext.id, amountKobo: ext.price_kobo }
        : { kind: 'wait', label: 'Waiting for patient payment', extensionId: ext.id };
    }
    case 'paid':
      return { kind: 'none', label: `Extended by ${ext.added_minutes} min`, extensionId: ext.id };
    case 'declined':
    case 'expired':
    case 'cancelled':
      return { kind: 'request', label: 'Request again' };
    default:
      return { kind: 'none', label: '' };
  }
}

/**
 * Whole minutes the server will still accept on top of this session. The
 * engine refuses an extension that would push the session past booked_start +
 * four hours, and caps any single extension at 240 minutes.
 */
export function maxExtensionMinutes(
  session: Pick<ConsultSession, 'booked_start' | 'ends_at'>,
): number {
  const start = Date.parse(session.booked_start);
  const ends = Date.parse(session.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(ends)) return 0;
  const headroom = start + MAX_SESSION_WINDOW_MS - ends;
  return Math.max(0, Math.min(MAX_EXTENSION_MINUTES, Math.floor(headroom / 60_000)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
node --experimental-strip-types --test "src/features/consult/__tests__/roomView.test.ts"
```
Expected: 8 tests PASS.

- [ ] **Step 5: Write the extension sheet**

Create `mobile-app/reactnative/src/features/consult/ExtensionSheet.tsx`:

```tsx
// The one place either side extends a consult. Every control here is advisory:
// the engine re-checks state, approval and the payment window, so a stale tap
// returns a 409 instead of granting unpaid time.

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, Clock, X } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { formatConsultClock } from './sessionTimer';
import {
  extensionAction,
  maxExtensionMinutes,
  openExtension,
  type ConsultViewer,
} from './roomView';
import type { ConsultExtension, ConsultSession } from './types';

const PRESETS = [10, 15, 30, 60];

export interface ExtensionSheetProps {
  visible: boolean;
  session: ConsultSession;
  extensions: ConsultExtension[];
  viewer: ConsultViewer;
  /** Server-projected "now" (client clock + serverOffsetMs). */
  nowMs: number;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onRequest: (minutes: number) => void;
  onDecide: (extensionId: string, approve: boolean) => void;
  onPay: (ext: ConsultExtension) => void;
}

export default function ExtensionSheet({
  visible,
  session,
  extensions,
  viewer,
  nowMs,
  busy = false,
  error,
  onClose,
  onRequest,
  onDecide,
  onPay,
}: ExtensionSheetProps) {
  const cap = maxExtensionMinutes(session);
  const options = useMemo(() => PRESETS.filter((m) => m <= cap), [cap]);
  const [minutes, setMinutes] = useState(options[0] ?? 10);
  const open = openExtension(extensions);
  const action = extensionAction(open, viewer, nowMs);
  const paid = extensions.filter((ext) => ext.status === 'paid' && ext.price_kobo > 0).slice(-2);

  useEffect(() => {
    if (!options.includes(minutes)) setMinutes(options[0] ?? 10);
  }, [minutes, options]);

  const payWindow =
    open?.payment_expires_at && action.kind === 'pay'
      ? Math.max(0, Math.ceil((Date.parse(open.payment_expires_at) - nowMs) / 1000))
      : null;

  const askLabel = viewer === 'provider' ? `Add ${minutes} min` : `Request ${minutes} min`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Session time</Text>
            {!busy && (
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={22} color={Colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.clockRow}>
              <Clock size={18} color={Colors.secondary} />
              <Text style={styles.clockText}>
                Booked for {session.duration_minutes} minutes · ends{' '}
                {new Date(session.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>

            {open?.status === 'pending_approval' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {open.added_minutes} more minutes requested
                </Text>
                <Text style={styles.cardBody}>
                  {viewer === 'provider'
                    ? `The patient will pay ${formatNaira(open.price_kobo, { decimals: false })} after you approve.`
                    : 'Waiting for the provider to approve. You pay only after approval.'}
                </Text>
                {viewer === 'provider' ? (
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.secondaryButton, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => onDecide(open.id, false)}
                    >
                      <Text style={styles.secondaryLabel}>Decline</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryButton, styles.grow, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => onDecide(open.id, true)}
                    >
                      <Check size={16} color={Colors.onPrimary} />
                      <Text style={styles.primaryLabel}>Approve</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.waitRow}>
                    <ActivityIndicator size="small" color={Colors.secondary} />
                    <Text style={styles.waitText}>Awaiting approval…</Text>
                  </View>
                )}
              </View>
            )}

            {open?.status === 'approved_awaiting_payment' && action.kind !== 'closed' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Approved — {open.added_minutes} more minutes</Text>
                <Text style={styles.cardBody}>
                  {viewer === 'patient'
                    ? `Pay ${formatNaira(open.price_kobo, { decimals: false })} to add the time.`
                    : 'Approved. Waiting for the patient to pay.'}
                </Text>
                {viewer === 'patient' ? (
                  <>
                    {payWindow !== null && (
                      <Text style={styles.windowText}>
                        Offer expires in {formatConsultClock(payWindow)}
                      </Text>
                    )}
                    <Pressable
                      style={[styles.primaryButton, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => onPay(open)}
                    >
                      <Text style={styles.primaryLabel}>
                        Pay {formatNaira(open.price_kobo, { decimals: false })}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.waitRow}>
                    <ActivityIndicator size="small" color={Colors.secondary} />
                    <Text style={styles.waitText}>Awaiting payment…</Text>
                  </View>
                )}
              </View>
            )}

            {action.kind === 'closed' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>The payment window closed</Text>
                <Text style={styles.cardBody}>Ask to extend again if the session is still running.</Text>
              </View>
            )}

            {(action.kind === 'request' || action.kind === 'closed') && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>How much longer?</Text>
                {options.length === 0 ? (
                  <Text style={styles.cardBody}>
                    This session cannot be extended any further — it has reached its four-hour limit.
                  </Text>
                ) : (
                  <>
                    <View style={styles.chips}>
                      {options.map((m) => {
                        const selected = m === minutes;
                        return (
                          <Pressable
                            key={m}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => setMinutes(m)}
                            disabled={busy}
                          >
                            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                              {m} min
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.helper}>
                      {viewer === 'provider'
                        ? 'Extensions you add are free and apply immediately.'
                        : 'Your provider must approve before you pay. The price is shown after approval.'}
                    </Text>
                    <Pressable
                      style={[styles.primaryButton, busy && styles.disabled]}
                      disabled={busy || options.length === 0}
                      onPress={() => onRequest(minutes)}
                    >
                      <Text style={styles.primaryLabel}>{askLabel}</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}

            {paid.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Already added</Text>
                {paid.map((ext) => (
                  <Text key={ext.id} style={styles.cardBody}>
                    +{ext.added_minutes} min · {formatNaira(ext.price_kobo, { decimals: false })}
                  </Text>
                ))}
              </View>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: Spacing.sm,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  body: { padding: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  clockText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  grow: { flex: 1 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
  },
  primaryLabel: { ...Typography.labelLg, color: Colors.onPrimary },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.outline,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
  },
  secondaryLabel: { ...Typography.labelLg, color: Colors.onSurface },
  disabled: { opacity: 0.5 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  waitText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  windowText: { ...Typography.labelMd, color: Colors.onWarning },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurface },
  chipLabelSelected: { color: Colors.onPrimary },
  helper: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error },
});
```

- [ ] **Step 6: Write the shared room**

Create `mobile-app/reactnative/src/features/consult/ConsultRoom.tsx`:

```tsx
// One room for every vertical. Module screens supply only the session id and
// what "end" means to their own appointment; the timer, media, chat and
// extension flow are identical everywhere.
//
// The countdown follows the server clock: every session read carries
// `server_now`, and the offset is re-derived on each poll, so a device with a
// wrong clock still sees the same 0:00 the engine enforces.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ChevronLeft,
  Clock,
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  Send,
  ShieldAlert,
  Video as VideoIcon,
  VideoOff,
  X,
} from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { confirmAsync } from '@/lib/confirm';
import { useAuthStore } from '@/store/authStore';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { completeConsultSession } from './api';
import { consultTimer, serverOffsetMs } from './sessionTimer';
import {
  useConsultExtensions,
  useConsultJoin,
  useConsultMessages,
  useConsultSession,
  useDecideConsultExtension,
  usePayConsultExtension,
  useRequestConsultExtension,
  useSendConsultMessage,
} from './hooks';
import {
  canJoinNow,
  extensionAction,
  openExtension,
  viewerOf,
  type ConsultViewer,
} from './roomView';
import { useConsultMedia } from './useConsultMedia';
import ConsultVideo from './ConsultVideo';
import ExtensionSheet from './ExtensionSheet';
import { CONSULT_MODE_LABEL, type ConsultExtension, type ConsultSession } from './types';

export interface ConsultRoomProps {
  sessionId: string;
  role: 'patient' | 'provider';
  /** Module completion. Defaults to the engine's own Complete endpoint. */
  onEnd?: () => Promise<unknown>;
  onBack?: () => void;
}

export default function ConsultRoom({ sessionId, role, onEnd, onBack }: ConsultRoomProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const { data: session, dataUpdatedAt, error: sessionError, refetch } = useConsultSession(sessionId);
  const extensions = useConsultExtensions(sessionId);
  const messages = useConsultMessages(sessionId);
  const join = useConsultJoin(sessionId);
  const sendMessage = useSendConsultMessage(sessionId);
  const requestExtension = useRequestConsultExtension(sessionId);
  const decideExtension = useDecideConsultExtension(sessionId);
  const payExtension = usePayConsultExtension(sessionId);
  const checkout = usePurchasePayment<{ extension: ConsultExtension; session: ConsultSession }>();

  const [tick, setTick] = useState(() => Date.now());
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  // One automatic join per room mount. A failed join must not retry every
  // render; the room shows a Reconnect button instead.
  const joinAttempted = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    joinAttempted.current = false;
  }, [sessionId]);

  const offsetMs = session ? serverOffsetMs(session.server_now, dataUpdatedAt) : 0;
  const projectedNow = tick + offsetMs;

  const viewer: ConsultViewer = session
    ? userId
      ? viewerOf(session, userId)
      : role
    : role;

  const timer = session
    ? consultTimer(
        {
          endsAt: session.ends_at,
          warnAt: session.warn_at,
          state: session.state,
          extendable: session.extendable,
        },
        tick,
        offsetMs,
      )
    : null;

  const expired = timer?.phase === 'expired';
  const joinable = Boolean(
    session && session.mode !== 'chat' && !expired && canJoinNow(session, projectedNow),
  );

  useEffect(() => {
    if (!joinable || joinAttempted.current) return;
    joinAttempted.current = true;
    join.mutate();
  }, [joinable, join]);

  const joined = Boolean(join.data);
  const media = useConsultMedia(join.data ?? null, session?.mode ?? 'chat', joined && !expired);

  useEffect(() => {
    if (session?.mode === 'chat') setChatOpen(true);
  }, [session?.mode]);

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages.data?.length, chatOpen]);

  const ext = openExtension(extensions.data);
  const action = extensionAction(ext, viewer, projectedNow);
  const canExtend = Boolean(session?.extendable) && !expired;
  const showChatPanel = session?.mode === 'chat' || chatOpen;
  const readOnly = expired;

  const startExtensionPayment = (extension: ConsultExtension) => {
    // PayExtension debits the wallet, so the wallet rail is the only one that
    // fits: the card rail would top up the wallet and then debit it.
    checkout.start({
      amountKobo: extension.price_kobo,
      title: `Extend by ${extension.added_minutes} min`,
      domain: 'consult_extension',
      method: 'wallet',
      charge: () => payExtension.mutateAsync(extension.id),
      onPaid: () => setExtensionOpen(false),
    });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || readOnly) return;
    setDraft('');
    try {
      await sendMessage.mutateAsync(body);
    } catch {
      setDraft(body);
    }
  };

  const end = async () => {
    const ok = await confirmAsync({
      title: 'End this session?',
      message: 'The timer stops for both sides and media is cut immediately.',
      confirmLabel: 'End session',
      cancelLabel: 'Keep going',
      destructive: true,
    });
    if (!ok) return;
    setEnding(true);
    setEndError(null);
    try {
      await (onEnd ? onEnd() : completeConsultSession(sessionId));
      await refetch();
    } catch (e) {
      setEndError(e instanceof Error ? e.message : 'Could not end the session.');
    } finally {
      setEnding(false);
    }
  };

  const back = () => {
    if (onBack) onBack();
    else router.back();
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.gate}>
        {sessionError ? (
          <>
            <ShieldAlert size={34} color={Colors.error} />
            <Text style={styles.gateText}>
              {sessionError instanceof Error ? sessionError.message : 'This session is unavailable.'}
            </Text>
            <Pressable style={styles.secondaryButton} onPress={() => void refetch()}>
              <Text style={styles.secondaryLabel}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={10} style={styles.headerButton}>
          <ChevronLeft size={22} color={Colors.onSurface} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text style={styles.headerTitleText}>
            {CONSULT_MODE_LABEL[session.mode]} consult
          </Text>
          <Text style={styles.headerSub}>
            {formatNaira(session.price_kobo, { decimals: false })} · {session.duration_minutes} min
          </Text>
        </View>
        <View style={[styles.timerChip, timer?.warning && styles.timerChipWarn, expired && styles.timerChipEnd]}>
          <Clock
            size={14}
            color={expired ? Colors.onError : timer?.warning ? Colors.onWarning : Colors.onSurface}
          />
          <Text
            style={[
              styles.timerText,
              timer?.warning && styles.timerTextWarn,
              expired && styles.timerTextEnd,
            ]}
          >
            {expired ? 'Ended' : timer?.label ?? '--:--'}
          </Text>
        </View>
      </View>

      {timer?.phase === 'warning' && canExtend && (
        <View style={styles.warnBar}>
          <Clock size={16} color={Colors.onWarning} />
          <Text style={styles.warnText}>Session ends in {timer.label}.</Text>
          <Pressable onPress={() => setExtensionOpen(true)} hitSlop={8}>
            <Text style={styles.warnAction}>Extend</Text>
          </Pressable>
        </View>
      )}

      {expired && (
        <View style={styles.endBar}>
          <Text style={styles.endBarText}>
            {session.state === 'ended' || session.state === 'cancelled'
              ? 'This session has ended. You are still signed in.'
              : 'Session time is up. Media has ended — you are still signed in.'}
          </Text>
        </View>
      )}

      {action.kind === 'approve' && (
        <Pressable style={styles.requestBar} onPress={() => setExtensionOpen(true)}>
          <Text style={styles.requestBarText}>
            The patient asked for {ext?.added_minutes} more minutes · Review
          </Text>
        </Pressable>
      )}

      {action.kind === 'pay' && viewer === 'patient' && (
        <Pressable style={styles.requestBar} onPress={() => setExtensionOpen(true)}>
          <Text style={styles.requestBarText}>
            Extension approved · Pay {formatNaira(ext?.price_kobo ?? 0, { decimals: false })}
          </Text>
        </Pressable>
      )}

      {session.mode === 'chat' ? (
        <ChatPanel
          messages={messages.data ?? []}
          userId={userId}
          draft={draft}
          setDraft={setDraft}
          onSend={() => void send()}
          readOnly={readOnly}
          sending={sendMessage.isPending}
          scrollRef={scrollRef}
        />
      ) : (
        <View style={styles.stageWrap}>
          <View style={styles.stage}>
            {session.mode === 'video' ? (
              media.remoteVideo ? (
                <ConsultVideo publication={media.remoteVideo} label="Remote video" />
              ) : (
                <View style={styles.stageEmpty}>
                  {join.isPending || media.status === 'connecting' ? (
                    <ActivityIndicator color={Colors.inverseOnSurface} />
                  ) : (
                    <VideoIcon size={34} color={Colors.inverseOnSurface} />
                  )}
                  <Text style={styles.stageEmptyText}>
                    {expired
                      ? 'The session has ended.'
                      : media.status === 'failed'
                        ? media.error ?? 'Could not connect to the room.'
                        : joined
                          ? 'Waiting for the other person to join…'
                          : 'Connecting to your session…'}
                  </Text>
                  {media.status === 'failed' && !expired && (
                    <Pressable style={styles.retryButton} onPress={() => join.mutate()}>
                      <Text style={styles.retryLabel}>Reconnect</Text>
                    </Pressable>
                  )}
                </View>
              )
            ) : (
              <View style={styles.stageEmpty}>
                <View style={styles.audioAvatar}>
                  <Phone size={34} color={Colors.onPrimary} />
                </View>
                <Text style={styles.audioMeta}>
                  {joined ? 'Voice session in progress' : 'Connecting to your session…'}
                </Text>
              </View>
            )}

            {session.mode === 'video' && media.localVideo && (
              <View style={styles.pip}>
                <ConsultVideo publication={media.localVideo} label="You" muted mirrored />
              </View>
            )}
          </View>

          {showChatPanel && (
            <View style={styles.drawer}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>Session chat</Text>
                <Pressable onPress={() => setChatOpen(false)} hitSlop={10}>
                  <X size={20} color={Colors.onSurfaceVariant} />
                </Pressable>
              </View>
              <ChatPanel
                messages={messages.data ?? []}
                userId={userId}
                draft={draft}
                setDraft={setDraft}
                onSend={() => void send()}
                readOnly={readOnly}
                sending={sendMessage.isPending}
                scrollRef={scrollRef}
              />
            </View>
          )}

          <View style={styles.controls}>
            <ControlButton
              active={media.micOn}
              label={media.micOn ? 'Mute' : 'Unmute'}
              onPress={() => void media.setMic(!media.micOn)}
              disabled={expired || !joined}
            >
              {media.micOn ? <Mic size={20} color={Colors.onSurface} /> : <MicOff size={20} color={Colors.error} />}
            </ControlButton>

            {session.mode === 'video' && (
              <ControlButton
                active={media.camOn}
                label={media.camOn ? 'Camera off' : 'Camera on'}
                onPress={() => void media.setCam(!media.camOn)}
                disabled={expired || !joined}
              >
                {media.camOn ? <VideoIcon size={20} color={Colors.onSurface} /> : <VideoOff size={20} color={Colors.error} />}
              </ControlButton>
            )}

            <ControlButton
              active={showChatPanel}
              label="Chat"
              onPress={() => setChatOpen((open) => !open)}
            >
              <MessageCircle size={20} color={Colors.onSurface} />
            </ControlButton>

            <ControlButton
              active={false}
              label="Extend"
              onPress={() => setExtensionOpen(true)}
              disabled={!canExtend}
            >
              <Clock size={20} color={canExtend ? Colors.onSurface : Colors.outline} />
            </ControlButton>

            <ControlButton active={false} label="End" onPress={() => void end()} disabled={ending}>
              <PhoneOffIcon />
            </ControlButton>
          </View>
        </View>
      )}

      {session.mode === 'chat' && (
        <View style={styles.chatControls}>
          <Pressable
            style={[styles.extendButton, !canExtend && styles.disabled]}
            disabled={!canExtend}
            onPress={() => setExtensionOpen(true)}
          >
            <Clock size={16} color={Colors.primary} />
            <Text style={styles.extendLabel}>
              {canExtend ? `Extend · ${formatNaira(session.price_kobo, { decimals: false })}/${session.duration_minutes}min` : 'No extensions left'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.endButton, ending && styles.disabled]}
            disabled={ending}
            onPress={() => void end()}
          >
            <Text style={styles.endButtonLabel}>{ending ? 'Ending…' : 'End session'}</Text>
          </Pressable>
        </View>
      )}

      {endError ? <Text style={styles.error}>{endError}</Text> : null}
      {media.error && session.mode !== 'video' ? <Text style={styles.error}>{media.error}</Text> : null}

      <ExtensionSheet
        visible={extensionOpen}
        session={session}
        extensions={extensions.data ?? []}
        viewer={viewer}
        nowMs={projectedNow}
        busy={
          requestExtension.isPending || decideExtension.isPending || payExtension.isPending || checkout.visible
        }
        error={extensionError(requestExtension.error, decideExtension.error, payExtension.error)}
        onClose={() => setExtensionOpen(false)}
        onRequest={(minutes) => requestExtension.mutate(minutes)}
        onDecide={(id, approve) => decideExtension.mutate({ extensionId: id, approve })}
        onPay={(extension) => {
          setExtensionOpen(false);
          startExtensionPayment(extension);
        }}
      />

      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

function extensionError(...errors: unknown[]): string | null {
  for (const e of errors) {
    if (e) return e instanceof Error ? e.message : 'That request could not be completed.';
  }
  return null;
}

function PhoneOffIcon() {
  return (
    <View style={styles.phoneOff}>
      <Phone size={18} color={Colors.onError} style={{ transform: [{ rotate: '135deg' }] }} />
    </View>
  );
}

function ControlButton({
  active,
  label,
  onPress,
  disabled,
  children,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      style={[styles.control, active && styles.controlActive, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
    >
      {children}
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

function ChatPanel({
  messages,
  userId,
  draft,
  setDraft,
  onSend,
  readOnly,
  sending,
  scrollRef,
}: {
  messages: { id: string; sender_id: string; body: string; created_at: string }[];
  userId?: string;
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  readOnly: boolean;
  sending: boolean;
  scrollRef: React.RefObject<ScrollView | null>;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.chatWrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.chatBody} keyboardShouldPersistTaps="handled">
        {messages.length === 0 ? (
          <Text style={styles.chatEmpty}>
            {readOnly ? 'No messages were exchanged.' : 'Messages sent here stay with this timed session.'}
          </Text>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === userId;
            return (
              <View key={message.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</Text>
                  <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {readOnly ? (
        <View style={styles.readOnlyBar}>
          <Text style={styles.readOnlyText}>This session has ended. The transcript is read-only.</Text>
        </View>
      ) : (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={Colors.outline}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}
            disabled={!draft.trim() || sending}
            onPress={onSend}
          >
            {sending ? <ActivityIndicator size="small" color={Colors.onPrimary} /> : <Send size={18} color={Colors.onPrimary} />}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  gateText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerButton: { padding: Spacing.xs },
  headerTitle: { flex: 1 },
  headerTitleText: { ...Typography.titleMd, color: Colors.onSurface },
  headerSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainer,
  },
  timerChipWarn: { backgroundColor: Colors.gold },
  timerChipEnd: { backgroundColor: Colors.errorContainer },
  timerText: { ...Typography.labelMd, color: Colors.onSurface, fontVariant: ['tabular-nums'] },
  timerTextWarn: { color: Colors.onWarning },
  timerTextEnd: { color: Colors.error },
  warnBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: '#FFF4CC',
  },
  warnText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  warnAction: { ...Typography.labelLg, color: Colors.onWarning },
  endBar: {
    marginHorizontal: Spacing.md,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.errorContainer,
  },
  endBarText: { ...Typography.bodySm, color: Colors.error },
  requestBar: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryFixed,
  },
  requestBarText: { ...Typography.labelMd, color: Colors.onPrimaryFixedVariant },
  stageWrap: { flex: 1, padding: Spacing.md, gap: Spacing.md },
  stage: {
    flex: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.backdropDark,
  },
  stageEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.lg },
  stageEmptyText: { ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center' },
  audioAvatar: {
    width: 96,
    height: 96,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryContainer,
  },
  audioMeta: { ...Typography.labelLg, color: Colors.inverseOnSurface },
  pip: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.md,
    width: 108,
    height: 150,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.surfaceContainerLowest,
  },
  retryButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  retryLabel: { ...Typography.labelMd, color: Colors.onSurface },
  drawer: {
    maxHeight: 280,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    overflow: 'hidden',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.outlineVariant,
  },
  drawerTitle: { ...Typography.labelLg, color: Colors.onSurface },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingVertical: Spacing.sm,
  },
  control: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    minWidth: 58,
    backgroundColor: Colors.surfaceContainer,
  },
  controlActive: { backgroundColor: Colors.surfaceContainerHigh },
  controlLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  phoneOff: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error,
  },
  chatWrap: { flex: 1 },
  chatBody: { padding: Spacing.md, gap: Spacing.sm },
  chatEmpty: { ...Typography.bodySm, color: Colors.outline, textAlign: 'center', marginTop: Spacing.lg },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2 },
  bubbleTheirs: { backgroundColor: Colors.surfaceContainer },
  bubbleMine: { backgroundColor: Colors.primary },
  bubbleText: { ...Typography.bodyMd, color: Colors.onSurface },
  bubbleTextMine: { color: Colors.onPrimary },
  bubbleTime: { ...Typography.caption, color: Colors.outline },
  bubbleTimeMine: { color: Colors.primaryFixedDim },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainer,
    color: Colors.onSurface,
    ...Typography.bodyMd,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  readOnlyBar: {
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  readOnlyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  chatControls: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  extendButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: 12,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  extendLabel: { ...Typography.labelMd, color: Colors.primary },
  endButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: Radius.full,
    backgroundColor: Colors.errorContainer,
  },
  endButtonLabel: { ...Typography.labelMd, color: Colors.error },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.outline,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  secondaryLabel: { ...Typography.labelMd, color: Colors.onSurface },
  disabled: { opacity: 0.45 },
  error: {
    ...Typography.bodySm,
    color: Colors.error,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
});
```

- [ ] **Step 7: Export the room pieces**

Replace `mobile-app/reactnative/src/features/consult/index.ts` with:

```ts
export * from './types';
export * from './sessionTimer';
export * from './api';
export * from './hooks';
export * from './roomView';
export { default as PackagePicker } from './PackagePicker';
export { default as ConsultVideo } from './ConsultVideo';
export { useConsultMedia } from './useConsultMedia';
export { default as ExtensionSheet } from './ExtensionSheet';
export { default as ConsultRoom } from './ConsultRoom';
```

- [ ] **Step 8: Typecheck and run the node tests**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:consult
npm run typecheck
npm run check:confirm
```
Expected: 16 tests PASS (8 timer + 8 room view), `tsc --noEmit` exits 0, and the confirm check reports no raw `Alert.alert` gates.

- [ ] **Step 9: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add mobile-app/reactnative/src/features/consult/roomView.ts \
        mobile-app/reactnative/src/features/consult/__tests__/roomView.test.ts \
        mobile-app/reactnative/src/features/consult/ExtensionSheet.tsx \
        mobile-app/reactnative/src/features/consult/ConsultRoom.tsx \
        mobile-app/reactnative/src/features/consult/index.ts
git commit -m "feat(consult): shared consult room with server-clock timer and extensions"
```

### Task 11: Telemedicine booking — packages in the picker and the quote

**Files:**
- Modify: `mobile-app/reactnative/src/types/telemedicine.ts` (`DoctorPackage`, `Doctor.packages`, `BookAppointmentInput.packageId`)
- Modify: `mobile-app/reactnative/src/api/telemedicine.api.ts` (`bookAppointment` body)
- Modify: `mobile-app/reactnative/app/services/telemedicine/doctor/[id]/book.tsx` (package picker)
- Modify: `mobile-app/reactnative/app/services/telemedicine/book/confirm.tsx` (package quote + `package_id`)
- Test: `mobile-app/reactnative/tests/unit/telemedicine/consultPackages.spec.ts`

**Interfaces:**
- Consumes: `GET /api/v1/telemedicine/doctors/:id` now returns `packages: [{id, mode, duration_minutes, price_kobo, booking}]` (Task 5); `POST /api/v1/telemedicine/appointments` accepts `package_id` (Task 5); `offersFromDoctorPackages` via `offerFromDoctorPackage` and `PackagePicker` from `@/features/consult` (Tasks 8 and 10).
- Produces: `DoctorPackage` (snake_case wire shape, owned by the telemedicine module), `Doctor.packages?: DoctorPackage[]`, `BookAppointmentInput.packageId?: string`. The book screen passes `packageId` to the confirm screen; the confirm screen prices the booking from `picked.booking` and never from `doctor.booking` when a package was picked.

- [ ] **Step 1: Write the failing mapping tests**

Create `mobile-app/reactnative/tests/unit/telemedicine/consultPackages.spec.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapLiveDoctor } from '@/features/telemedicine/mapping';
import { offerFromDoctorPackage } from '@/features/consult/types';

test('mapLiveDoctor carries the doctor package list through unchanged', () => {
  const doctor = mapLiveDoctor({
    id: 'doc-1',
    name: 'Dr Amaka Obi',
    specialty: 'general',
    consult_fee_kobo: 500_000,
    packages: [
      {
        id: 'pkg-1',
        mode: 'video',
        duration_minutes: 30,
        price_kobo: 700_000,
        booking: {
          consult_fee_kobo: 700_000,
          platform_fee_bp: 500,
          platform_fee_kobo: 35_000,
          total_kobo: 735_000,
        },
      },
    ],
  });

  assert.equal(doctor.packages?.length, 1);
  assert.deepEqual(offerFromDoctorPackage(doctor.packages![0]), {
    id: 'pkg-1',
    mode: 'video',
    durationMinutes: 30,
    priceKobo: 700_000,
    totalKobo: 735_000,
  });
});

test('a package the picker cannot interpret is dropped, never guessed', () => {
  const doctor = mapLiveDoctor({
    id: 'doc-2',
    name: 'Dr Tunde Bello',
    specialty: 'cardiology',
    packages: [{ id: 'pkg-2', mode: 'telepathy', duration_minutes: 30, price_kobo: 100_000 }],
  });

  const offers = (doctor.packages ?? []).map(offerFromDoctorPackage).filter(Boolean);
  assert.deepEqual(offers, []);
});

test('a package without a server quote totals its package price and speaks voice', () => {
  const doctor = mapLiveDoctor({
    id: 'doc-3',
    name: 'Dr Ngozi Eze',
    specialty: 'dermatology',
    packages: [{ id: 'pkg-3', mode: 'audio', duration_minutes: 20, price_kobo: 300_000 }],
  });

  const offer = offerFromDoctorPackage(doctor.packages![0]);
  assert.equal(offer?.mode, 'voice');
  assert.equal(offer?.priceKobo, 300_000);
  assert.equal(offer?.totalKobo, 300_000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:telemedicine -- tests/unit/telemedicine/consultPackages.spec.ts
```
Expected: FAIL — `Property 'packages' does not exist on type 'Doctor'` (or a runtime `offerFromDoctorPackage is not exported` if types were loose).

- [ ] **Step 3: Add the package types**

In `mobile-app/reactnative/src/types/telemedicine.ts`, add above `Doctor`:

```ts
/**
 * One priced consultation option as `GET /doctors/:id` sends it. snake_case on
 * purpose: this is the engine's wire row and `offerFromDoctorPackage` reads
 * exactly this shape. `booking` is the server quote for this price point, so
 * the picker renders `total_kobo` and never computes the platform fee itself
 * (ADR-044).
 */
export interface DoctorPackage {
  id:               string;
  mode:             string;   // video | voice | the module's "audio" | chat
  duration_minutes: number;
  price_kobo:       number;
  booking?:         { total_kobo?: number; totalKobo?: number };
}
```

Add to `Doctor`, below `booking`:

```ts
  /**
   * Timed price points this doctor sells. Empty/absent means the doctor has not
   * adopted timed consults and the legacy consultation-type picker applies.
   */
  packages?:       DoctorPackage[];
```

Add to `BookAppointmentInput`, after `consultType`:

```ts
  /** The picked `DoctorPackage.id`. Empty keeps the legacy fee-priced booking. */
  packageId?:     string;
```

- [ ] **Step 4: Send `package_id` on the booking request**

In `mobile-app/reactnative/src/api/telemedicine.api.ts`, inside `bookAppointment`'s `body`, add after `consultation_type`:

```ts
    package_id:          input.packageId || undefined,
```

So the body reads:

```ts
  const body = {
    doctor_id:           input.doctorId,
    scheduled_at:        input.scheduledAt,
    consultation_type:   input.consultType,
    package_id:          input.packageId || undefined,
    notes:               input.reason,
    idempotency_key:     idempotencyKey,
    expected_total_kobo: input.expectedTotalKobo ?? 0,
  };
```

- [ ] **Step 5: Add the picker to the booking screen**

In `mobile-app/reactnative/app/services/telemedicine/doctor/[id]/book.tsx`:

Change the React import to include `useMemo`:

```tsx
import React, { useMemo, useState } from 'react';
```

Add the consult imports below the `ConsultTypePicker` import:

```tsx
import {
  PackagePicker,
  offerFromDoctorPackage,
  type ConsultMode,
  type ConsultOffer,
} from '@/features/consult';
```

Add the mode-to-type helper above the component:

```tsx
/** The module still spells a voice consult "audio". */
function consultTypeFor(mode: ConsultMode): ConsultType {
  return mode === 'voice' ? 'audio' : mode;
}
```

Inside the component, after the `reason` state, add:

```tsx
  const [selectedOffer, setSelectedOffer] = useState<ConsultOffer | null>(null);
  const offers = useMemo(
    () =>
      (doctor?.packages ?? [])
        .map(offerFromDoctorPackage)
        .filter((offer): offer is ConsultOffer => offer !== null),
    [doctor?.packages],
  );
```

Wait: `offers` uses `doctor` before its declaration if placed before the query. Place the `offers` memo **after** the `doctor` query and keep `selectedOffer` state with the other state. Final order:

```tsx
  const [selectedOffer, setSelectedOffer] = useState<ConsultOffer | null>(null);
  ...
  const { data: doctor } = useQuery({ ... });
  const offers = useMemo(..., [doctor?.packages]);
```

Replace `canContinue`:

```tsx
  const canContinue =
    !!selectedSlot &&
    reason.trim().length > 0 &&
    (offers.length === 0 || selectedOffer !== null);
```

Replace the consultation-type block:

```tsx
        <Text style={styles.label}>Consultation type</Text>
        <ConsultTypePicker selected={consultType} onSelect={setConsultType} />
```

with:

```tsx
        {offers.length > 0 ? (
          <>
            <Text style={styles.label}>Consultation package</Text>
            <PackagePicker
              offers={offers}
              selectedId={selectedOffer?.id ?? null}
              onSelect={setSelectedOffer}
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>Consultation type</Text>
            <ConsultTypePicker selected={consultType} onSelect={setConsultType} />
          </>
        )}
```

Replace the `onContinue` body's `params`:

```tsx
      params: {
        doctorId: doctor.id,
        slotId: selectedSlot.id,
        slotDate: selectedSlot.date,
        slotTime: selectedSlot.time,
        consultType: selectedOffer ? consultTypeFor(selectedOffer.mode) : consultType,
        packageId: selectedOffer?.id ?? '',
        reason: reason.trim(),
      },
```

- [ ] **Step 6: Price the booking from the picked package**

In `mobile-app/reactnative/app/services/telemedicine/book/confirm.tsx`:

Extend the params type:

```tsx
  const params = useLocalSearchParams<{
    doctorId: string; slotId: string; slotDate: string; slotTime: string;
    consultType: ConsultType; reason: string; packageId?: string;
  }>();
```

Add `readBookingQuote` to the existing pricing import:

```tsx
import { readBookingQuote, slotToISO } from '@/features/telemedicine/pricing';
```

Replace the quote block:

```tsx
  // The server's price breakdown. Every figure on this screen — the rows, the
  // balance check, the Pay button, the amount handed to the payment sheet —
  // derives from it, so what the patient is shown is what the backend escrows.
  const quote = doctor?.booking;
```

with:

```tsx
  // The server's price breakdown for the option the patient actually picked.
  // A package carries its own quote; using the doctor-level quote here would
  // show (and charge) the legacy fee for a package booking.
  const pickedPackage = doctor?.packages?.find((pkg) => pkg.id === params.packageId);
  const quote = pickedPackage
    ? readBookingQuote({ booking: pickedPackage.booking })
    : doctor?.booking;
```

Inside the `charge` callback, add after `consultType`:

```tsx
          packageId: pickedPackage?.id,
```

So the booking input reads:

```tsx
        bookAppointmentAsync({
          doctorId: doctor.id,
          slotId: String(params.slotId),
          scheduledAt: slotToISO(params.slotDate, params.slotTime),
          consultType: params.consultType,
          packageId: pickedPackage?.id,
          reason: String(params.reason ?? ''),
          feeKobo,
          expectedTotalKobo: totalKobo,
          idempotencyKey: idemKeyRef.current,
        }),
```

- [ ] **Step 7: Run the tests and typecheck**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:telemedicine -- tests/unit/telemedicine/consultPackages.spec.ts
npm run typecheck
```
Expected: 3 tests PASS and `tsc --noEmit` exits 0.

- [ ] **Step 8: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add mobile-app/reactnative/src/types/telemedicine.ts \
        mobile-app/reactnative/src/api/telemedicine.api.ts \
        "mobile-app/reactnative/app/services/telemedicine/doctor/[id]/book.tsx" \
        mobile-app/reactnative/app/services/telemedicine/book/confirm.tsx \
        mobile-app/reactnative/tests/unit/telemedicine/consultPackages.spec.ts
git commit -m "feat(telemedicine): sell and quote timed consult packages at booking"
```

### Task 12: Telemedicine rooms and the doctor's package pricing

**Files:**
- Modify: `mobile-app/reactnative/src/features/consult/types.ts` (`ConsultPackageWire`, `PublishConsultPackageInput`)
- Modify: `mobile-app/reactnative/src/features/consult/api.ts` (`listConsultPackages`, `publishConsultPackage`)
- Create: `mobile-app/reactnative/src/features/consult/packages.ts`
- Create: `mobile-app/reactnative/src/features/consult/__tests__/packages.test.ts`
- Create: `mobile-app/reactnative/app/(doctor)/consult/packages.tsx`
- Create: `mobile-app/reactnative/app/(doctor)/consult/[id]/room.tsx`
- Create: `mobile-app/reactnative/app/services/telemedicine/consult/[id]/room.tsx`
- Modify: `mobile-app/reactnative/app/services/telemedicine/appointment/[id].tsx` (join button targets the timed room)
- Modify: `mobile-app/reactnative/app/services/telemedicine/book/success.tsx` (join button targets the timed room)
- Modify: `mobile-app/reactnative/app/(doctor)/consult/[id]/pre-call.tsx`
- Modify: `mobile-app/reactnative/app/(doctor)/_layout.tsx`
- Modify: `mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `ConsultRoom` and the consult engine client from `@/features/consult` (Tasks 8–10); `POST /api/v1/telemedicine/appointments/:id/consult-session` and `POST /api/v1/telemedicine/appointments/:id/complete`; `GET/POST /api/v1/consult/packages` (Slice 1 routes — owner identity is the caller's own user id for `owner_kind='doctor'`).
- Produces:
  - `listConsultPackages({ vertical, ownerKind, ownerId })` → `ConsultPackageWire[]`
  - `publishConsultPackage(input)` → `ConsultPackageWire`
  - `nairaToKobo`, `validatePackageDraft`, `packagePayload` from `./packages`
  - Routes `/services/telemedicine/consult/:appointmentId/room` (patient), `/(doctor)/consult/:appointmentId/room` (doctor), `/(doctor)/consult/packages` (doctor pricing).

- [ ] **Step 1: Write the failing package-draft tests**

Create `mobile-app/reactnative/src/features/consult/__tests__/packages.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nairaToKobo, packagePayload, validatePackageDraft } from '../packages.ts';

const OWNER = { ownerKind: 'doctor' as const, ownerId: 'user-1', vertical: 'telemedicine' as const };

test('nairaToKobo accepts grouped and decimal naira, and refuses nonsense', () => {
  assert.equal(nairaToKobo('2,000'), 200_000);
  assert.equal(nairaToKobo('₦2,000.50'), 200_050);
  assert.equal(nairaToKobo(' 1500 '), 150_000);
  assert.equal(nairaToKobo(''), 0);
  assert.equal(nairaToKobo('abc'), 0);
  assert.equal(nairaToKobo('0'), 0);
});

test('duration must be a whole number from 5 to 480 minutes', () => {
  assert.equal(validatePackageDraft({ mode: 'video', durationMinutes: 30, priceNaira: '2000' }), null);
  assert.match(
    validatePackageDraft({ mode: 'video', durationMinutes: 4, priceNaira: '2000' }) ?? '',
    /5 and 480/,
  );
  assert.match(
    validatePackageDraft({ mode: 'video', durationMinutes: 481, priceNaira: '2000' }) ?? '',
    /5 and 480/,
  );
  assert.match(
    validatePackageDraft({ mode: 'video', durationMinutes: 30.5, priceNaira: '2000' }) ?? '',
    /whole number/,
  );
});

test('price must be greater than zero', () => {
  assert.match(validatePackageDraft({ mode: 'chat', durationMinutes: 15, priceNaira: '' }) ?? '', /price/i);
  assert.match(validatePackageDraft({ mode: 'chat', durationMinutes: 15, priceNaira: '0' }) ?? '', /price/i);
});

test('packagePayload sends the engine snake_case body with kobo', () => {
  assert.deepEqual(
    packagePayload({ mode: 'voice', durationMinutes: 20, priceNaira: '1,500' }, OWNER),
    {
      ownerKind: 'doctor',
      ownerId: 'user-1',
      vertical: 'telemedicine',
      mode: 'voice',
      durationMinutes: 20,
      priceKobo: 150_000,
    },
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
node --experimental-strip-types --test "src/features/consult/__tests__/packages.test.ts"
```
Expected: FAIL — `Cannot find module '../packages.ts'`.

- [ ] **Step 3: Implement the draft helpers**

Create `mobile-app/reactnative/src/features/consult/packages.ts`:

```ts
// Provider-side package drafts. Pure and folder-local so the node runner can
// test it: the screen collects naira and minutes, the engine takes kobo.

import type { ConsultMode, ConsultVertical, PublishConsultPackageInput } from './types';

export const MIN_PACKAGE_MINUTES = 5;
export const MAX_PACKAGE_MINUTES = 480;

export interface PackageDraft {
  mode: ConsultMode;
  durationMinutes: number;
  /** What the provider typed. Grouped ("2,000") and symbol-prefixed input is accepted. */
  priceNaira: string;
}

export interface PackageOwner {
  ownerKind: 'doctor' | 'health_provider';
  ownerId: string;
  vertical: ConsultVertical;
}

export function nairaToKobo(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const naira = Number(cleaned);
  if (!Number.isFinite(naira) || naira <= 0) return 0;
  return Math.round(naira * 100);
}

export function validatePackageDraft(draft: PackageDraft): string | null {
  if (!Number.isInteger(draft.durationMinutes)) {
    return 'Enter the duration as a whole number of minutes.';
  }
  if (draft.durationMinutes < MIN_PACKAGE_MINUTES || draft.durationMinutes > MAX_PACKAGE_MINUTES) {
    return `Duration must be between ${MIN_PACKAGE_MINUTES} and ${MAX_PACKAGE_MINUTES} minutes.`;
  }
  if (nairaToKobo(draft.priceNaira) <= 0) {
    return 'Enter a price greater than ₦0.';
  }
  return null;
}

export function packagePayload(draft: PackageDraft, owner: PackageOwner): PublishConsultPackageInput {
  return {
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    vertical: owner.vertical,
    mode: draft.mode,
    durationMinutes: draft.durationMinutes,
    priceKobo: nairaToKobo(draft.priceNaira),
  };
}
```

- [ ] **Step 4: Add the package wire types and client calls**

In `mobile-app/reactnative/src/features/consult/types.ts`, add at the bottom:

```ts
/** One price point as the engine's package routes send it. */
export interface ConsultPackageWire {
  id: string;
  owner_kind: 'doctor' | 'health_provider';
  owner_id: string;
  vertical: ConsultVertical;
  mode: ConsultMode;
  duration_minutes: number;
  price_kobo: number;
  active: boolean;
}

export interface PublishConsultPackageInput {
  ownerKind: 'doctor' | 'health_provider';
  ownerId: string;
  vertical: ConsultVertical;
  mode: ConsultMode;
  durationMinutes: number;
  priceKobo: number;
}
```

In `mobile-app/reactnative/src/features/consult/api.ts`, extend the type import with `ConsultPackageWire`, `PublishConsultPackageInput`, `ConsultVertical`, then append:

```ts
export async function listConsultPackages(input: {
  vertical: ConsultVertical;
  ownerKind: 'doctor' | 'health_provider';
  ownerId: string;
}): Promise<ConsultPackageWire[]> {
  const { data } = await api.get<{ success?: boolean; packages?: ConsultPackageWire[] }>(
    `${CONSULT_BASE}/packages`,
    {
      params: {
        vertical: input.vertical,
        owner_kind: input.ownerKind,
        owner_id: input.ownerId,
      },
    },
  );
  return data?.packages ?? [];
}

export async function publishConsultPackage(
  input: PublishConsultPackageInput,
): Promise<ConsultPackageWire> {
  const { data } = await api.post<{ package?: ConsultPackageWire; error?: string }>(
    `${CONSULT_BASE}/packages`,
    {
      owner_kind: input.ownerKind,
      owner_id: input.ownerId,
      vertical: input.vertical,
      mode: input.mode,
      duration_minutes: input.durationMinutes,
      price_kobo: input.priceKobo,
    },
  );
  if (!data?.package) throw new Error(data?.error ?? 'The package could not be saved.');
  return data.package;
}
```

The import block becomes:

```ts
import type {
  ConsultExtension,
  ConsultJoin,
  ConsultMessage,
  ConsultPackageWire,
  ConsultRtc,
  ConsultSession,
  ConsultVertical,
  PublishConsultPackageInput,
} from './types';
```

- [ ] **Step 5: Run the package-draft tests**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
node --experimental-strip-types --test "src/features/consult/__tests__/packages.test.ts"
```
Expected: 4 tests PASS.

- [ ] **Step 6: Write the doctor's package pricing screen**

Create `mobile-app/reactnative/app/(doctor)/consult/packages.tsx`:

```tsx
// A doctor's timed price list. One press publishes (or re-prices) a price point;
// the booking picker reads the same rows immediately afterwards. The engine
// upserts on (owner, vertical, mode, duration), so re-publishing the same
// combination is a price edit, never a duplicate.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone, Video } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { useAuthStore } from '@/store/authStore';
import { TeleHeader } from '@/features/telemedicine/components';
import { listConsultPackages, publishConsultPackage } from '@/features/consult/api';
import { nairaToKobo, packagePayload, validatePackageDraft, type PackageDraft } from '@/features/consult/packages';
import {
  CONSULT_MODE_LABEL,
  type ConsultMode,
  type ConsultPackageWire,
} from '@/features/consult/types';

const MODES: ConsultMode[] = ['video', 'voice', 'chat'];
const DURATIONS = [15, 20, 30, 45, 60];
const OWNER = { ownerKind: 'doctor' as const, vertical: 'telemedicine' as const };

const MODE_ICON = {
  video: Video,
  voice: Phone,
  chat: MessageCircle,
} as const;

export default function DoctorConsultPackagesScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PackageDraft>({
    mode: 'video',
    durationMinutes: 30,
    priceNaira: '2000',
  });
  const [error, setError] = useState<string | null>(null);

  const packages = useQuery({
    queryKey: ['consult', 'packages', 'doctor', userId],
    queryFn: () => listConsultPackages({ ...OWNER, ownerId: userId as string }),
    enabled: Boolean(userId),
    staleTime: 0,
  });

  const publish = useMutation({
    mutationFn: () =>
      publishConsultPackage(packagePayload(draft, { ...OWNER, ownerId: userId as string })),
    onSuccess: (saved) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['consult', 'packages', 'doctor', userId] });
      // Keep the form on what was just saved, so a price edit loops naturally.
      setDraft((d) => ({ ...d, mode: saved.mode, durationMinutes: saved.duration_minutes, priceNaira: String(saved.price_kobo / 100) }));
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save this package.'),
  });

  const save = () => {
    const problem = validatePackageDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    publish.mutate();
  };

  const rows = packages.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Consultation prices" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Set what a timed {`video, voice or chat`} consultation costs. Patients pick one of these
          before booking, and the timer follows the duration you set here.
        </Text>

        <Text style={styles.label}>Published</Text>
        {packages.isLoading ? (
          <ActivityIndicator color={Colors.primary} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>
            No packages yet. Until you publish one, patients book at your legacy consultation fee.
          </Text>
        ) : (
          <View style={styles.list}>
            {rows.map((pkg) => (
              <PackageRow key={pkg.id} pkg={pkg} onEdit={() => {
                setDraft({ mode: pkg.mode, durationMinutes: pkg.duration_minutes, priceNaira: String(pkg.price_kobo / 100) });
              }} />
            ))}
          </View>
        )}

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Add or update a price</Text>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Mode</Text>
          <View style={styles.chips}>
            {MODES.map((mode) => {
              const selected = draft.mode === mode;
              const Icon = MODE_ICON[mode];
              return (
                <Pressable
                  key={mode}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setDraft((d) => ({ ...d, mode }))}
                >
                  <Icon size={14} color={selected ? Colors.onPrimary : Colors.onSurface} />
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {CONSULT_MODE_LABEL[mode]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Duration</Text>
          <View style={styles.chips}>
            {DURATIONS.map((minutes) => {
              const selected = draft.durationMinutes === minutes;
              return (
                <Pressable
                  key={minutes}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setDraft((d) => ({ ...d, durationMinutes: minutes }))}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {minutes} min
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={styles.input}
            value={String(draft.durationMinutes)}
            onChangeText={(text) =>
              setDraft((d) => ({ ...d, durationMinutes: Number(text.replace(/[^0-9]/g, '')) }))
            }
            keyboardType="number-pad"
            placeholder="Custom minutes (5–480)"
            placeholderTextColor={Colors.outline}
          />

          <Text style={styles.fieldLabel}>Price (₦)</Text>
          <TextInput
            style={styles.input}
            value={draft.priceNaira}
            onChangeText={(priceNaira) => setDraft((d) => ({ ...d, priceNaira }))}
            keyboardType="decimal-pad"
            placeholder="2000"
            placeholderTextColor={Colors.outline}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.publishButton, publish.isPending && styles.disabled]}
            disabled={publish.isPending || !userId}
            onPress={save}
          >
            {publish.isPending ? (
              <ActivityIndicator size="small" color={Colors.onPrimary} />
            ) : (
              <Text style={styles.publishLabel}>Publish {formatNaira(nairaToKobo(draft.priceNaira), { decimals: false })}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PackageRow({ pkg, onEdit }: { pkg: ConsultPackageWire; onEdit: () => void }) {
  const Icon = MODE_ICON[pkg.mode];
  return (
    <Pressable style={styles.row} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${pkg.mode} ${pkg.duration_minutes} minute package`}>
      <View style={styles.rowIcon}>
        <Icon size={18} color={Colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>
          {CONSULT_MODE_LABEL[pkg.mode]} · {pkg.duration_minutes} min
        </Text>
        <Text style={styles.rowSub}>{formatNaira(pkg.price_kobo, { decimals: false })}</Text>
      </View>
      <Text style={styles.edit}>Edit</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  edit: { ...Typography.labelMd, color: Colors.secondary },
  card: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    gap: Spacing.sm,
  },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurface },
  chipLabelSelected: { color: Colors.onPrimary },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
  },
  publishButton: {
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  publishLabel: { ...Typography.labelLg, color: Colors.onPrimary },
  disabled: { opacity: 0.5 },
  error: { ...Typography.bodySm, color: Colors.error },
});
```

- [ ] **Step 7: Register the screen and give it a dashboard entry**

In `mobile-app/reactnative/app/(doctor)/_layout.tsx`, after the `<Stack.Screen name="availability" />` line, add:

```tsx
      <Stack.Screen name="consult/packages" />
```

After the `<Stack.Screen name="consult/[id]/call" />` line, add:

```tsx
      <Stack.Screen name="consult/[id]/room" />
```

In `mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx`, add `Clock` to the identical import list so it ends with `BadgeCheck, Clock`:

```tsx
  Inbox, Users, MessageSquare, Smile, Video, AlertTriangle, ShieldAlert, UserCog, CalendarClock, Pill, RefreshCw, BadgeCheck, Clock,
```

Then insert this Pressable between the `</View>` that closes `styles.actionsGrid` and the `{/* Phase 3 entry points */}` comment:

```tsx
        <Pressable
          style={styles.consultPrices}
          onPress={() => router.push('/(doctor)/consult/packages')}
          accessibilityRole="button"
          accessibilityLabel="Consultation prices"
        >
          <View style={[styles.phase3Icon, { backgroundColor: Colors.iconBgTeal }]}>
            <Clock size={18} color={Colors.teal} strokeWidth={2} />
          </View>
          <Text style={styles.consultPricesLabel}>Consultation prices</Text>
          <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
```

Add to the stylesheet, next to `phase3Link`:

```tsx
  consultPrices:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  consultPricesLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
```

- [ ] **Step 8: Add the doctor room route and point pre-call at it**

Create `mobile-app/reactnative/app/(doctor)/consult/[id]/room.tsx`:

```tsx
// The doctor's side of the shared room. Opening is idempotent server-side, so
// re-entering this route after a reload re-attaches to the same session.
// Ending goes through the module's own complete route, which also ends the
// consult session and settles the appointment in one transaction.

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { Colors, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { ConsultRoom } from '@/features/consult';
import { openTelemedicineConsultSession } from '@/features/consult/api';
import { completeAppointment } from '@/api/telemedicine.api';

export default function DoctorConsultRoomScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const appointmentId = String(id);

  const open = useMutation({
    mutationFn: () => openTelemedicineConsultSession(appointmentId),
  });

  useEffect(() => {
    if (appointmentId) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  if (open.data) {
    return (
      <ConsultRoom
        sessionId={open.data.id}
        role="provider"
        onEnd={() => completeAppointment(appointmentId)}
        onBack={() => router.replace(`/(doctor)/consult/${appointmentId}/notes`)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {open.error ? (
          <>
            <Text style={styles.error}>
              {open.error instanceof Error ? open.error.message : 'This consultation is unavailable.'}
            </Text>
            <PrimaryButton label="Try again" onPress={() => open.mutate()} />
            <PrimaryButton
              label="Use the standard room"
              variant="ghost"
              onPress={() =>
                router.replace(
                  `/(doctor)/consult/${appointmentId}/call${mode ? `?mode=${mode}` : ''}`,
                )
              }
            />
          </>
        ) : (
          <>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loading}>Opening the consultation…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  loading: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
});
```

The standard-room button is the videosdk rollback: the engine answers `503` and the doctor keeps the legacy call screen instead of being stranded.

In `mobile-app/reactnative/app/(doctor)/consult/[id]/pre-call.tsx`, replace:

```tsx
            onPress={() => router.replace(`/(doctor)/consult/${appointmentId}/call?mode=${callMode}`)}
```

with:

```tsx
            onPress={() => router.replace(`/(doctor)/consult/${appointmentId}/room?mode=${callMode}`)}
```

- [ ] **Step 9: Add the patient room route**

Create `mobile-app/reactnative/app/services/telemedicine/consult/[id]/room.tsx`:

```tsx
// The patient's side of the shared room. It carries the intake gate itself, so
// a deep link (or an old link into the legacy screen) can never start the
// server timer before intake is SUBMITTED. Leaving does not end the timer —
// the engine still ends it at `ends_at` or when the doctor completes.

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { ConsultRoom } from '@/features/consult';
import { openTelemedicineConsultSession } from '@/features/consult/api';
import { useApptIntake } from '@/features/health/hooks';

export default function TelemedicineConsultRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);

  // PRD §1 structural gate: the consult cannot start until intake is SUBMITTED.
  // Fail-safe — anything other than an explicit SUBMITTED blocks the room, and
  // the session is not opened (so the server clock is not started) until then.
  const intakeQ = useApptIntake(appointmentId);
  const intakeReady = intakeQ.data?.intake.status === 'SUBMITTED';

  const open = useMutation({
    mutationFn: () => openTelemedicineConsultSession(appointmentId),
  });

  useEffect(() => {
    if (appointmentId && intakeReady) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, intakeReady]);

  const leave = () => router.replace(`/services/telemedicine/appointment/${appointmentId}/summary`);

  if (!intakeReady) {
    const loading = intakeQ.isLoading;
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.gateWrap}>
          <View style={styles.gateIcon}>
            <ClipboardList size={40} color={Colors.primary} strokeWidth={1.8} />
          </View>
          <Text style={styles.gateTitle}>
            {loading ? 'Checking your intake…' : 'Complete your health intake first'}
          </Text>
          <Text style={styles.gateBody}>
            {loading
              ? 'One moment.'
              : 'Your consultation can’t start until you’ve shared your health details with the doctor. It only takes a minute and helps your doctor prepare.'}
          </Text>
          {!loading && (
            <View style={styles.gateActions}>
              <PrimaryButton
                label="Add your health details"
                onPress={() => router.replace(`/services/telemedicine/appointment/${appointmentId}/intake`)}
              />
              <PrimaryButton
                label="Back to appointment"
                variant="ghost"
                onPress={() => router.replace(`/services/telemedicine/appointment/${appointmentId}`)}
              />
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (open.data) {
    return <ConsultRoom sessionId={open.data.id} role="patient" onBack={leave} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {open.error ? (
          <>
            <Text style={styles.error}>
              {open.error instanceof Error ? open.error.message : 'This consultation is unavailable.'}
            </Text>
            <PrimaryButton label="Try again" onPress={() => open.mutate()} />
            <PrimaryButton
              label="Use the standard room"
              variant="ghost"
              onPress={() => router.replace(`/services/telemedicine/consult/${appointmentId}`)}
            />
            <PrimaryButton label="Back to appointment" variant="ghost" onPress={leave} />
          </>
        ) : (
          <>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loading}>Opening your consultation…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  loading: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
  gateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  gateIcon: {
    width: 76,
    height: 76,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  gateTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  gateBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  gateActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
```

- [ ] **Step 10: Retarget the patient's join buttons at the timed room**

`app/services/telemedicine/consult/[id].tsx` is the legacy VideoSDK room and the
`videosdk` rollback path, so it stays untouched on its existing path. Only the
two places that send a patient into a consultation change.

In `mobile-app/reactnative/app/services/telemedicine/appointment/[id].tsx`, replace:

```tsx
              onPress={() => router.push(`/services/telemedicine/consult/${appt.id}`)}
```

with:

```tsx
              onPress={() => router.push(`/services/telemedicine/consult/${appt.id}/room`)}
```

In `mobile-app/reactnative/app/services/telemedicine/book/success.tsx`, replace:

```tsx
            onPress={() => router.replace(`/services/telemedicine/consult/${params.appointmentId}`)}
```

with:

```tsx
            onPress={() => router.replace(`/services/telemedicine/consult/${params.appointmentId}/room`)}
```

The legacy route still resolves as a direct URL, and the timed room's error state
offers it as "Use the standard room" when the engine is unwired.

- [ ] **Step 11: Verify**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:consult
npm run typecheck
npm run check:confirm
```
Expected: 20 tests PASS (8 timer + 8 room view + 4 package drafts), `tsc --noEmit` exits 0, and `check:confirm` passes (the new end-session confirmation uses `confirmAsync`, not `Alert.alert`).

- [ ] **Step 12: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add mobile-app/reactnative/src/features/consult/types.ts \
        mobile-app/reactnative/src/features/consult/api.ts \
        mobile-app/reactnative/src/features/consult/packages.ts \
        mobile-app/reactnative/src/features/consult/__tests__/packages.test.ts \
        "mobile-app/reactnative/app/(doctor)/consult/packages.tsx" \
        "mobile-app/reactnative/app/(doctor)/consult/[id]/room.tsx" \
        "mobile-app/reactnative/app/(doctor)/consult/[id]/pre-call.tsx" \
        "mobile-app/reactnative/app/(doctor)/_layout.tsx" \
        "mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx" \
        "mobile-app/reactnative/app/services/telemedicine/appointment/[id].tsx" \
        "mobile-app/reactnative/app/services/telemedicine/book/success.tsx" \
        "mobile-app/reactnative/app/services/telemedicine/consult/[id]/room.tsx"
git commit -m "feat(telemedicine): doctor consult rooms and package pricing"
```

### Task 13: Veterinary booking, timed rooms, and package pricing

**Files:**
- Modify: `mobile-app/reactnative/src/features/health/vet/types.ts` (`VetPackage`, `Vet.packages`, booking pins, provider profile fields)
- Modify: `mobile-app/reactnative/src/features/health/vet/vetListing.ts` (carry `packages` off the listing)
- Modify: `mobile-app/reactnative/src/features/health/vet/__tests__/vetListing.test.ts` (package carry-through)
- Modify: `mobile-app/reactnative/app/health/vet/book.tsx` (package picker)
- Modify: `mobile-app/reactnative/app/health/vet/checkout.tsx` (package total + booking pins)
- Modify: `mobile-app/reactnative/app/health/vet/teleconsult-lobby.tsx` (open the timed session, keep the VideoSDK fallback)
- Create: `mobile-app/reactnative/app/health/vet/timed-consult.tsx`
- Create: `mobile-app/reactnative/app/health/vet/provider/timed-consult.tsx`
- Create: `mobile-app/reactnative/app/health/vet/provider/packages.tsx`
- Modify: `mobile-app/reactnative/app/health/vet/_layout.tsx`
- Modify: `mobile-app/reactnative/app/health/vet/provider/pet-chart.tsx` (start consult points at the timed room)
- Modify: `mobile-app/reactnative/app/health/vet/provider/profile.tsx`

**Interfaces:**
- Consumes: `PackagePicker`, `CONSULT_MODE_LABEL`, `offerFromVetPackage`, `type ConsultOffer`, `ConsultRoom`, `useConsultSession`, `openVetConsultSession`, `completeConsultSession` from `@/features/consult` (Tasks 9–10); `PackageDraft`, `nairaToKobo`, `validatePackageDraft`, `packagePayload` from `@/features/consult/packages`; `listConsultPackages`, `publishConsultPackage` from `@/features/consult/api` (Task 12); `POST /api/finance/health/vet/appointments/:id/consult-session` and `POST /api/finance/health/vet/provider/appointments/:id/consult-session` returning `{success, session}` (Task 6); booking pins `packageId`/`consultMode`/`expectedTotalKobo` on `vetapi/owner` (Task 6).
- Produces:
  - `VetPackage { id, mode, durationMinutes, priceKobo }`; `Vet.packages?: VetPackage[]`; `ProviderProfile.providerId?: string` and `.packages?: VetPackage[]`.
  - `CreateAppointmentInput.packageId?`, `.consultMode?`, `.expectedTotalKobo?`.
  - Routes `/health/vet/timed-consult` (pet owner), `/health/vet/provider/timed-consult` (vet), `/health/vet/provider/packages` (vet pricing).

- [ ] **Step 1: Write the failing listing test**

In `mobile-app/reactnative/src/features/health/vet/__tests__/vetListing.test.ts`, append:

```ts
test('mapListedVet carries the vet timed packages and defaults to none', () => {
  const withPackages = mapListedVet({
    ...wire,
    packages: [{ id: 'p1', mode: 'video', durationMinutes: 30, priceKobo: 200000 }],
  });
  assert.deepEqual(withPackages.packages, [
    { id: 'p1', mode: 'video', durationMinutes: 30, priceKobo: 200000 },
  ]);
  assert.deepEqual(
    mapListedVet({ id: 'x', name: 'Dr. X', credential: { authority: 'VCN', status: 'verified' } }).packages,
    [],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:vet-pet
```
Expected: FAIL — `withPackages.packages` is `undefined`.

- [ ] **Step 3: Add the package types and carry them off the listing**

In `mobile-app/reactnative/src/features/health/vet/types.ts`, add below the `Vet` interface:

```ts
/** One timed tele-consult price point, as the public listing and the vet's
 *  own profile send it. The engine re-prices from the id on booking. */
export interface VetPackage {
  id: string;
  mode: string;
  durationMinutes: number;
  priceKobo: number;
}
```

Inside `Vet`, after `clinicFeeKobo`:

```ts
  /** Priced timed tele-consult options. Empty when the vet sells none. */
  packages?: VetPackage[];
```

Inside `CreateAppointmentInput`, after `idempotencyKey`:

```ts
  /** Tele only: one of the vet's published timed packages. */
  packageId?: string;
  /** Tele only: requested mode when no package is chosen ("" means video). */
  consultMode?: VetConsultMode;
  /** Tele only: the total checkout showed, so the server can refuse a re-price. */
  expectedTotalKobo?: number;
```

Inside `ProviderProfile`, after `types`:

```ts
  /** health_providers row id — the owner id the consult engine keys packages on. */
  providerId?: string;
  /** Timed tele-consult price points published for this vet. */
  packages?: VetPackage[];
```

In `mobile-app/reactnative/src/features/health/vet/vetListing.ts`, extend the import:

```ts
import type { Vet, VetPackage } from './types';
```

Add to `ListedVetWire`, after `clinicFeeKobo`:

```ts
  packages?: VetPackage[];
```

Add to the object `mapListedVet` returns, after `clinicFeeKobo`:

```ts
    packages: raw.packages ?? [],
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:vet-pet
```
Expected: all vet tests PASS, including the new one.

- [ ] **Step 5: Put the package picker on the booking screen**

In `mobile-app/reactnative/app/health/vet/book.tsx`, add below the `formatNaira` import:

```ts
import {
  PackagePicker,
  CONSULT_MODE_LABEL,
  offerFromVetPackage,
  type ConsultOffer,
} from '@/features/consult';
```

Add the selection state after the `coords` state:

```ts
  const [offerId, setOfferId] = useState<string | null>(null);
```

Replace the default-type effect with:

```ts
  // default type to vet's first supported once loaded; vets who sell timed
  // packages default to the tele flow those packages belong to
  React.useEffect(() => {
    if (vet && !type) setType(vet.packages?.length ? 'tele' : vet.types[0]);
  }, [vet, type]);
```

Insert above `const fee = useMemo(...)`:

```ts
  const offers = useMemo(
    () =>
      (vet?.packages ?? [])
        .map(offerFromVetPackage)
        .filter((offer): offer is ConsultOffer => offer !== null),
    [vet?.packages],
  );
  const selectedOffer =
    type === 'tele' ? offers.find((offer) => offer.id === offerId) ?? offers[0] ?? null : null;
```

Replace the fee memo with:

```ts
  const fee = useMemo(() => {
    if (!vet || !type) return 0;
    if (type === 'tele' && selectedOffer) return selectedOffer.totalKobo;
    return type === 'home' ? vet.consultFeeKobo + vet.homeVisitFeeKobo : vet.consultFeeKobo;
  }, [vet, type, selectedOffer]);
```

Replace `canContinue` with:

```ts
  const canContinue =
    type &&
    slotIso &&
    (type !== 'tele' || offers.length === 0 || selectedOffer !== null) &&
    (type !== 'home' || address.trim().length > 3);
```

Insert the picker between the `</View>` that closes `styles.typeRow` and the `{/* Slots */}` comment:

```tsx
        {type === 'tele' && offers.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Consultation package</Text>
            <PackagePicker
              offers={offers}
              selectedId={selectedOffer?.id ?? null}
              onSelect={(offer) => setOfferId(offer.id)}
            />
          </>
        ) : null}
```

Add these params to the `router.push` payload, after `homeFeeKobo`:

```ts
        packageId: selectedOffer?.id ?? '',
        consultMode: type === 'tele' ? selectedOffer?.mode ?? 'video' : '',
        packageLabel: selectedOffer
          ? `${CONSULT_MODE_LABEL[selectedOffer.mode]} · ${selectedOffer.durationMinutes} min`
          : '',
        expectedTotalKobo: selectedOffer ? String(selectedOffer.totalKobo) : '',
```

Replace the fee card with:

```tsx
        <View style={[styles.feeCard, shadow1]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.feeLabel}>{selectedOffer ? 'Selected package' : 'Estimated fee'}</Text>
            {selectedOffer ? (
              <Text style={styles.feeCaption}>
                {CONSULT_MODE_LABEL[selectedOffer.mode]} · {selectedOffer.durationMinutes} min
              </Text>
            ) : null}
          </View>
          <Text style={styles.feeVal}>{formatNaira(fee)}</Text>
        </View>
```

Add to the stylesheet, after `feeLabel`:

```ts
  feeCaption: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
```

- [ ] **Step 6: Price the checkout from the package and pin the booking**

In `mobile-app/reactnative/app/health/vet/checkout.tsx`, extend the params type with:

```ts
    packageId?: string;
    consultMode?: string;
    packageLabel?: string;
    expectedTotalKobo?: string;
```

Extend the types import:

```ts
import type { AppointmentType, Appointment, VetConsultMode } from '@/features/health/vet/types';
```

Below `const type = ...`, add:

```ts
  const packageId = params.packageId || undefined;
  const consultMode = (params.consultMode as VetConsultMode) || undefined;
  const expectedTotalKobo = Number(params.expectedTotalKobo ?? 0) || 0;
```

Replace the `totalKobo` line with:

```ts
  // A package names its own total. Legacy visits keep the fee + home fee split.
  const totalKobo = packageId && expectedTotalKobo > 0 ? expectedTotalKobo : feeKobo + homeFeeKobo;
```

In the `createAppt.mutateAsync({ ... })` payload, after `homeVisitFeeKobo: homeFeeKobo,`, add:

```ts
          packageId,
          consultMode: type === 'tele' ? consultMode ?? 'video' : undefined,
          expectedTotalKobo: packageId ? totalKobo : undefined,
```

Replace the first summary row with:

```tsx
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>
              {packageId ? params.packageLabel ?? 'Timed consult' : 'Consult fee'}
            </Text>
            <Text style={styles.sumVal}>{formatNaira(packageId ? totalKobo : feeKobo)}</Text>
          </View>
```

- [ ] **Step 7: Open the timed session in the lobby, with the legacy room as fallback**

Replace `mobile-app/reactnative/app/health/vet/teleconsult-lobby.tsx` with:

```tsx
import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Wifi, Volume2, Video } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import EmergencyBanner from '@/features/health/components/EmergencyBanner';
import { useAppointment, useConsult } from '@/features/health/vet/hooks';
import { VET_EMERGENCY_DISCLAIMER } from '@/features/health/vet/constants';
import { openVetConsultSession, useConsultSession } from '@/features/consult';

const CHECKS = [
  { icon: Wifi, label: 'Network connection looks good' },
  { icon: Video, label: 'Camera ready' },
  { icon: Volume2, label: 'Microphone ready' },
];

export default function TeleconsultLobbyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appointmentId = String(id);
  const { data: appt, isLoading, isError, refetch } = useAppointment(appointmentId);
  const { data: consult } = useConsult(appt ? (appt.consultId ?? appt.id) : '');

  // Open the one timed session pinned to this appointment. When the engine's
  // media rail is unavailable the mutation fails and the legacy VideoSDK room
  // stays reachable — that is the rollback path the spec requires.
  const open = useMutation({ mutationFn: () => openVetConsultSession(appointmentId) });

  useEffect(() => {
    open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  const session = open.data;
  const poll = useConsultSession(session?.id);
  const state = poll.data?.state ?? session?.state;
  const timed = Boolean(session);
  const ready = timed ? state === 'live' : Boolean(consult?.providerReady);
  // Hold Join until the open-session call settles, so a fast tap can never race
  // the engine and land in the legacy room while a timed session was created.
  const routingSettled = !open.isPending;

  const status = !timed
    ? consult?.providerReady
      ? 'Your vet is ready to start'
      : 'Waiting for your vet to join…'
    : state === 'live'
      ? 'Your vet is ready to start'
      : state === 'ended' || state === 'cancelled'
        ? 'This consultation has ended'
        : 'Waiting for your vet to join…';

  const join = () => {
    if (timed) {
      router.replace({ pathname: '/health/vet/timed-consult', params: { appointmentId } });
      return;
    }
    router.replace({
      pathname: '/health/vet/teleconsult',
      params: { id: appt?.consultId ?? appt?.id ?? appointmentId, appointmentId },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Consult lobby" />
        <StateView kind="loading" message="Preparing your lobby…" />
      </SafeAreaView>
    );
  }
  if (isError || !appt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Consult lobby" />
        <StateView kind="error" title="Couldn't load this consult" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Consult lobby" subtitle={appt.vetName} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{appt.vetName.replace(/^Dr\.?\s*/, '').charAt(0)}</Text>
          </View>
          <Text style={styles.name}>{appt.vetName}</Text>
          <Text style={styles.sub}>Tele-consult for {appt.petName}</Text>
          <View style={[styles.statusChip, ready ? styles.statusOn : styles.statusOff]}>
            <Text style={[styles.statusText, { color: ready ? Colors.teal : Colors.onSurfaceVariant }]}>
              {status}
            </Text>
          </View>
          {open.isError ? (
            <Text style={styles.fallback}>
              The live timed room is unavailable right now, so the standard room opens instead.
            </Text>
          ) : null}
        </View>

        <EmergencyBanner message={VET_EMERGENCY_DISCLAIMER} />

        {session?.mode === 'chat' ? (
          <Text style={styles.sectionTitle}>
            This is a timed chat consultation — video and audio are not used.
          </Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Pre-call checks</Text>
            <View style={styles.checks}>
              {CHECKS.map((c) => (
                <View key={c.label} style={styles.checkRow}>
                  <View style={styles.checkIcon}>
                    <c.icon size={16} color={Colors.teal} strokeWidth={2} />
                  </View>
                  <Text style={styles.checkText}>{c.label}</Text>
                  <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={!routingSettled ? 'Opening your room…' : ready ? 'Join consult' : 'Join when ready'}
          onPress={join}
          disabled={!routingSettled}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: Spacing.lg },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  // letterSpacing re-stated: displayLg's -0.96 is -0.02em at its own 48px, and
  // spreading the style while overriding only the size keeps that ABSOLUTE
  // value, which is tighter than the scale intends at 40px. -0.8 is the same -0.02em.
  avatarText: { ...Typography.displayLg, fontSize: 40, letterSpacing: -0.8, color: Colors.primary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statusChip: { marginTop: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full },
  statusOn: { backgroundColor: Colors.iconBgTeal },
  statusOff: { backgroundColor: Colors.surfaceContainerHigh },
  statusText: { ...Typography.labelMd },
  fallback: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm, paddingHorizontal: Spacing.md },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  checks: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm },
  checkIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  checkText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
```

- [ ] **Step 8: Add the pet owner's timed room**

Create `mobile-app/reactnative/app/health/vet/timed-consult.tsx`:

```tsx
// The pet owner's side of the shared room. Opening is idempotent server-side,
// so a reload re-attaches to the same session. Leaving does not end the timer:
// the engine ends it at `ends_at` or when the vet completes the consult.

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { Colors, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { useAppointment } from '@/features/health/vet/hooks';
import { ConsultRoom, openVetConsultSession } from '@/features/consult';

export default function VetTimedConsultScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const apptId = String(appointmentId);
  const appointment = useAppointment(apptId);

  const open = useMutation({ mutationFn: () => openVetConsultSession(apptId) });

  useEffect(() => {
    if (apptId) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptId]);

  const leave = () => router.replace('/health/vet/appointments');

  if (open.data) {
    return <ConsultRoom sessionId={open.data.id} role="patient" onBack={leave} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {open.error ? (
          <>
            <Text style={styles.error}>
              {open.error instanceof Error ? open.error.message : 'This consultation is unavailable.'}
            </Text>
            <PrimaryButton label="Try again" onPress={() => open.mutate()} />
            <PrimaryButton
              label="Use the standard room"
              variant="ghost"
              onPress={() =>
                router.replace({
                  pathname: '/health/vet/teleconsult',
                  params: { id: appointment.data?.consultId ?? apptId, appointmentId: apptId },
                })
              }
            />
            <PrimaryButton label="Back to appointments" variant="ghost" onPress={leave} />
          </>
        ) : (
          <>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loading}>Opening your consultation…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  loading: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
});
```

- [ ] **Step 9: Add the vet's timed room**

Create `mobile-app/reactnative/app/health/vet/provider/timed-consult.tsx`:

```tsx
// The vet's side of the shared room. Ending here stops the session for both
// sides and opens the SOAP note; saving the note is still what completes the
// legacy consult and releases the held payment (HL-9).

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { Colors, Spacing, Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { useAppointment } from '@/features/health/vet/hooks';
import { ConsultRoom, completeConsultSession, openVetConsultSession } from '@/features/consult';

export default function VetProviderTimedConsultScreen() {
  const { id, appointmentId } = useLocalSearchParams<{ id: string; appointmentId?: string }>();
  const apptId = String(appointmentId ?? id);
  const appointment = useAppointment(apptId);

  const open = useMutation({ mutationFn: () => openVetConsultSession(apptId, true) });

  useEffect(() => {
    if (apptId) open.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptId]);

  const notes = () =>
    router.replace({
      pathname: '/health/vet/provider/soap-notes',
      params: { appointmentId: apptId, petId: appointment.data?.petId ?? '' },
    });

  if (open.data) {
    const sessionId = open.data.id;
    return (
      <ConsultRoom
        sessionId={sessionId}
        role="provider"
        onEnd={async () => {
          await completeConsultSession(sessionId);
          notes();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {open.error ? (
          <>
            <Text style={styles.error}>
              {open.error instanceof Error ? open.error.message : 'This consultation is unavailable.'}
            </Text>
            <PrimaryButton label="Try again" onPress={() => open.mutate()} />
            <PrimaryButton
              label="Use the standard room"
              variant="ghost"
              onPress={() =>
                router.replace({
                  pathname: '/health/vet/provider/teleconsult',
                  params: { id: apptId, appointmentId: apptId },
                })
              }
            />
            <PrimaryButton label="Write notes instead" variant="ghost" onPress={notes} />
          </>
        ) : (
          <>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loading}>Opening the consultation…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  loading: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
});
```

- [ ] **Step 10: Add the vet's package pricing screen**

Create `mobile-app/reactnative/app/health/vet/provider/packages.tsx`:

```tsx
// The vet's timed price list. Publishing is an upsert on
// (owner, vertical, mode, duration), so re-publishing the same combination
// edits the price instead of creating a duplicate. The owner id is the
// health_providers row id the provider profile already exposes; the public
// listing reads the same rows, so a saved price is pickable immediately.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone, Video } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import { formatNaira } from '@/features/health/constants/health.constants';
import { useProviderProfile } from '@/features/health/vet/hooks';
import { listConsultPackages, publishConsultPackage } from '@/features/consult/api';
import {
  nairaToKobo,
  packagePayload,
  validatePackageDraft,
  type PackageDraft,
} from '@/features/consult/packages';
import {
  CONSULT_MODE_LABEL,
  type ConsultMode,
  type ConsultPackageWire,
} from '@/features/consult/types';

const MODES: ConsultMode[] = ['video', 'voice', 'chat'];
const DURATIONS = [15, 20, 30, 45, 60];
const VERTICAL = 'vet' as const;

const MODE_ICON = {
  video: Video,
  voice: Phone,
  chat: MessageCircle,
} as const;

export default function VetConsultPackagesScreen() {
  const profile = useProviderProfile();
  const providerId = profile.data?.providerId;
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PackageDraft>({
    mode: 'video',
    durationMinutes: 30,
    priceNaira: '2000',
  });
  const [error, setError] = useState<string | null>(null);

  const packages = useQuery({
    queryKey: ['consult', 'packages', 'vet', providerId],
    queryFn: () =>
      listConsultPackages({
        vertical: VERTICAL,
        ownerKind: 'health_provider',
        ownerId: providerId as string,
      }),
    enabled: Boolean(providerId),
    staleTime: 0,
  });

  const publish = useMutation({
    mutationFn: () =>
      publishConsultPackage(
        packagePayload(draft, {
          ownerKind: 'health_provider',
          ownerId: providerId as string,
          vertical: VERTICAL,
        }),
      ),
    onSuccess: (saved) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['consult', 'packages', 'vet', providerId] });
      qc.invalidateQueries({ queryKey: ['vet', 'provider', 'profile'] });
      setDraft((d) => ({
        ...d,
        mode: saved.mode,
        durationMinutes: saved.duration_minutes,
        priceNaira: String(saved.price_kobo / 100),
      }));
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save this package.'),
  });

  const save = () => {
    const problem = validatePackageDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    publish.mutate();
  };

  const rows = packages.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Consultation prices" subtitle="Timed tele-consults" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Set what a timed video, voice or chat consultation costs. Pet owners pick one of these
          before booking, and the consultation timer follows the duration you set here.
        </Text>

        {profile.data && !providerId ? (
          <Text style={styles.empty}>
            Finish onboarding before publishing prices. Until then, owners book at your legacy
            consultation fee.
          </Text>
        ) : (
          <>
            <Text style={styles.label}>Published</Text>
            {packages.isLoading ? (
              <ActivityIndicator color={Colors.primary} />
            ) : rows.length === 0 ? (
              <Text style={styles.empty}>
                No packages yet. Until you publish one, owners book at your legacy consultation fee.
              </Text>
            ) : (
              <View style={styles.list}>
                {rows.map((pkg) => (
                  <PackageRow
                    key={pkg.id}
                    pkg={pkg}
                    onEdit={() =>
                      setDraft({
                        mode: pkg.mode,
                        durationMinutes: pkg.duration_minutes,
                        priceNaira: String(pkg.price_kobo / 100),
                      })
                    }
                  />
                ))}
              </View>
            )}

            <Text style={[styles.label, { marginTop: Spacing.lg }]}>Add or update a price</Text>

            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Mode</Text>
              <View style={styles.chips}>
                {MODES.map((mode) => {
                  const selected = draft.mode === mode;
                  const Icon = MODE_ICON[mode];
                  return (
                    <Pressable
                      key={mode}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setDraft((d) => ({ ...d, mode }))}
                    >
                      <Icon size={14} color={selected ? Colors.onPrimary : Colors.onSurface} />
                      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                        {CONSULT_MODE_LABEL[mode]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Duration</Text>
              <View style={styles.chips}>
                {DURATIONS.map((minutes) => {
                  const selected = draft.durationMinutes === minutes;
                  return (
                    <Pressable
                      key={minutes}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setDraft((d) => ({ ...d, durationMinutes: minutes }))}
                    >
                      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                        {minutes} min
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={styles.input}
                value={String(draft.durationMinutes)}
                onChangeText={(text) =>
                  setDraft((d) => ({ ...d, durationMinutes: Number(text.replace(/[^0-9]/g, '')) }))
                }
                keyboardType="number-pad"
                placeholder="Custom minutes (5–480)"
                placeholderTextColor={Colors.outline}
              />

              <Text style={styles.fieldLabel}>Price (₦)</Text>
              <TextInput
                style={styles.input}
                value={draft.priceNaira}
                onChangeText={(priceNaira) => setDraft((d) => ({ ...d, priceNaira }))}
                keyboardType="decimal-pad"
                placeholder="2000"
                placeholderTextColor={Colors.outline}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                style={[styles.publishButton, publish.isPending && styles.disabled]}
                disabled={publish.isPending || !providerId}
                onPress={save}
              >
                {publish.isPending ? (
                  <ActivityIndicator size="small" color={Colors.onPrimary} />
                ) : (
                  <Text style={styles.publishLabel}>
                    Publish {formatNaira(nairaToKobo(draft.priceNaira))}
                  </Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PackageRow({ pkg, onEdit }: { pkg: ConsultPackageWire; onEdit: () => void }) {
  const Icon = MODE_ICON[pkg.mode];
  return (
    <Pressable
      style={styles.row}
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${pkg.mode} ${pkg.duration_minutes} minute package`}
    >
      <View style={styles.rowIcon}>
        <Icon size={18} color={Colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>
          {CONSULT_MODE_LABEL[pkg.mode]} · {pkg.duration_minutes} min
        </Text>
        <Text style={styles.rowSub}>{formatNaira(pkg.price_kobo)}</Text>
      </View>
      <Text style={styles.edit}>Edit</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  edit: { ...Typography.labelMd, color: Colors.secondary },
  card: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    gap: Spacing.sm,
  },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurface },
  chipLabelSelected: { color: Colors.onPrimary },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
  },
  publishButton: {
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  publishLabel: { ...Typography.labelLg, color: Colors.onPrimary },
  disabled: { opacity: 0.5 },
  error: { ...Typography.bodySm, color: Colors.error },
});
```

- [ ] **Step 11: Register the routes, point the chart at the room, and add the pricing entry**

In `mobile-app/reactnative/app/health/vet/provider/pet-chart.tsx`, change the consult action's `href` (leave the label, icon and key untouched):

```ts
    { key: 'consult', label: 'Start consult', icon: Video, href: { pathname: '/health/vet/provider/timed-consult', params: { id: appt, appointmentId: appt } } },
```

The timed room keeps the "Use the standard room" button as its `videosdk` rollback, so the chart has exactly one entry point.

In `mobile-app/reactnative/app/health/vet/_layout.tsx`, after `<Stack.Screen name="checkout" />`, add:

```tsx
          <Stack.Screen name="timed-consult" options={{ gestureEnabled: false }} />
```

After `<Stack.Screen name="provider/teleconsult" options={{ gestureEnabled: false }} />`, add:

```tsx
          <Stack.Screen name="provider/timed-consult" options={{ gestureEnabled: false }} />
          <Stack.Screen name="provider/packages" />
```

In `mobile-app/reactnative/app/health/vet/provider/profile.tsx`, extend the lucide import with `Clock`:

```ts
import { CalendarClock, Wallet, Star, ChevronRight, Check, MapPin, Clock } from 'lucide-react-native';
```

Add to `SHORTCUTS`, after the `avail` entry:

```ts
  { key: 'prices', label: 'Consultation prices', icon: Clock, href: '/health/vet/provider/packages' },
```

- [ ] **Step 12: Verify and commit**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:vet-pet
npm run test:consult
npm run typecheck
npm run check:confirm
```
Expected: vet tests PASS (including the new package carry-through), 20 consult tests PASS (8 timer + 8 room view + 4 package drafts), `tsc --noEmit` exits 0, and `check:confirm` passes.

```bash
cd /Users/paymax/Documents/spotlight/main
git add mobile-app/reactnative/src/features/health/vet/types.ts \
        mobile-app/reactnative/src/features/health/vet/vetListing.ts \
        mobile-app/reactnative/src/features/health/vet/__tests__/vetListing.test.ts \
        mobile-app/reactnative/app/health/vet/book.tsx \
        mobile-app/reactnative/app/health/vet/checkout.tsx \
        mobile-app/reactnative/app/health/vet/teleconsult-lobby.tsx \
        mobile-app/reactnative/app/health/vet/timed-consult.tsx \
        mobile-app/reactnative/app/health/vet/provider/timed-consult.tsx \
        mobile-app/reactnative/app/health/vet/provider/packages.tsx \
        mobile-app/reactnative/app/health/vet/_layout.tsx \
        mobile-app/reactnative/app/health/vet/provider/pet-chart.tsx \
        mobile-app/reactnative/app/health/vet/provider/profile.tsx
git commit -m "feat(vet): timed consult packages, rooms, and vet pricing"
```

### Task 14: End-to-end acceptance — both modules, timers, extensions, rollback

This task changes no code. It proves the slice against a real local stack and
records the evidence. Do not tick a box from a log alone — every UI step below
is observed in the browser.

**Files:** none.

**Interfaces:**
- Consumes: every route, screen and command produced by Tasks 1–13.

- [ ] **Step 1: Apply the migration and prove the pins exist**

```bash
cd /Users/paymax/Documents/spotlight/main
supabase migration up --include-all
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT table_name, column_name FROM information_schema.columns
WHERE table_name IN ('appointments','vet_appointment_payments')
  AND column_name IN ('consult_package_id','consult_mode','consult_duration_minutes')
ORDER BY table_name, column_name;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT indexname FROM pg_indexes
WHERE tablename='consult_sessions' AND indexname='uq_consult_sessions_source';"
```
Expected: six column rows, one index row.

- [ ] **Step 2: Run the backend gates**

```bash
cd /Users/paymax/Documents/spotlight/main/backend
go build ./... && go vet ./...
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./internal/health/consultengine ./internal/health/telemedicine ./internal/health/vet \
           ./internal/health/vetapi/... ./internal/app -count=1
```
Expected: build and vet print nothing; every package reports `ok`. A failure in
a package this slice did not touch is still a failure of this slice — fix it
before continuing.

- [ ] **Step 3: Run the mobile gates**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run test:consult
npm run test:vet-pet
npm run typecheck
npm run check:confirm
```
Expected: 20 consult tests PASS (8 timer + 8 room view + 4 package drafts), all
vet tests PASS, `tsc --noEmit` exits 0, and `check:confirm` reports no raw
`Alert.alert` gates.

- [ ] **Step 4: Start the stack on the LiveKit rail**

In `backend/.env` (never print it), confirm:

```dotenv
FEATURE_LIVEKIT_ENABLED=true
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=<local key>
LIVEKIT_API_SECRET=<local secret, 32+ chars>
CONSULT_MEDIA_PROVIDER=livekit
```

Start the API (rebuild to a temp binary and poll `/healthz` — a stale listener
serves old code):

```bash
cd /Users/paymax/Documents/spotlight/main/backend
go build -o /tmp/spotlight-api ./cmd/api
/tmp/spotlight-api
```

In a second terminal start the app:

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
npm run web
```

Open `http://localhost:8083` in two isolated browser profiles: one signed in as
a pet owner, one as a VCN-approved vet. The web bundle proxies to the local BFF
and API; if every request 401s, the web env file is missing — fix that before
judging the slice.

- [ ] **Step 5: Vet — publish a price in the workspace**

As the vet: **Profile → Consultation prices →** pick **Video**, **15 min**, price
**1500**, **Publish**.

Expected: the price appears under **Published** as `Video · 15 min` / `₦1,500`;
re-publishing the same combination edits it in place (no duplicate row).

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT owner_kind, vertical, mode, duration_minutes, price_kobo, active
FROM consult_session_packages
WHERE owner_kind='health_provider' AND vertical='vet'
ORDER BY created_at DESC LIMIT 3;"
```
Expected: one `health_provider | vet | video | 15 | 150000 | t` row.

- [ ] **Step 6: Vet — book with the package**

As the owner: find the vet, **Book**, confirm the **Consultation package** picker
shows `Video · 15 min ₦1,500`, pick the first slot, **Continue**, and confirm the
checkout summary reads `Video · 15 min` and **Total ₦1,500**. Pay and let it land
on the consult lobby.

Expected: booking succeeds and the lobby reports waiting for the vet. The
payment row carries the pin:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT consult_package_id IS NOT NULL AS pinned, consult_mode, consult_duration_minutes,
       total_kobo, pay_state
FROM vet_appointment_payments ORDER BY created_at DESC LIMIT 1;"
```
Expected: `t | video | 15 | 150000 | HELD`.

- [ ] **Step 7: Vet — open both sides of the timed room**

Owner presses **Join** in the lobby. Vet opens the appointment's **Start consult**
from the pet chart.

Expected:
- Both screens show the shared room with the same countdown (within one second),
  the owner's local preview, and the vet's video.
- Exactly one session row exists for the appointment:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT id, vertical, mode, duration_minutes, price_kobo, state,
       source_ref, ends_at - booked_start AS window
FROM consult_sessions WHERE vertical='vet' ORDER BY created_at DESC LIMIT 1;"
```
Expected: `vet | video | 15 | 150000 | live` and `window = 00:15:00`. Pressing
Join twice, or reloading, must not create a second row.

- [ ] **Step 8: Vet — chat and extension, approve then pay**

Send a message each way. Then as the owner press **Extend**, choose **10 min**,
and request. As the vet, open **Extend** and **Approve**. As the owner, pay the
extension in the sheet (wallet).

Expected:
- Before approval the owner sees "waiting for the vet"; after approval the owner
  sees a pay action whose amount expires at the shown clock.
- The paid extension adds exactly 10 minutes to `ends_at`:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT requested_by IS NOT NULL AS requested, added_minutes, price_kobo, status,
       approved_at IS NOT NULL AS approved, paid_at IS NOT NULL AS paid
FROM consult_extension_requests ORDER BY created_at DESC LIMIT 1;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT ends_at - booked_start AS window FROM consult_sessions
WHERE vertical='vet' ORDER BY created_at DESC LIMIT 1;"
```
Expected: `t | 10 | <positive kobo> | paid | t | t` and `window = 00:25:00`.

- [ ] **Step 9: Vet — warning, media cut, and staying signed in**

Speed the clock in the dev database (never in staging or production):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
UPDATE consult_sessions
SET ends_at = now() + interval '70 seconds',
    warn_at = now() + interval '10 seconds'
WHERE vertical='vet' AND state='live';"
```

Expected, within one poll interval (15 s):
- Both sides show the "ends in 5 minutes" warning banner.
- When the countdown reaches `00:00`, the video is cut on both sides, the timer
  reads ended, and both sessions stay signed in — no redirect to login, no
  crash. The extend control is closed.
- The session row is `ended` with `ended_at` set.

- [ ] **Step 10: Vet — vet ends early, SOAP still completes**

Repeat Steps 6–7 with a fresh booking, then press **End session** as the vet and
confirm. Expected: both sides cut immediately, the session row is `ended`, and
the vet lands on **SOAP notes**. Save a note.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT pay_state FROM vet_appointment_payments ORDER BY created_at DESC LIMIT 1;"
```
Expected: `RELEASED` — the held payment still releases through the module's own
completion path, and the engine session stays ended (idempotent).

- [ ] **Step 11: Telemedicine — doctor price, booking, room, extension**

As a doctor: **Dashboard → Consultation prices →** publish **Video · 30 min**,
**₦2,000**. As a patient: book that doctor, confirm the picker shows
`Video · 30 min ₦2,000`, pay, and open the consult from the appointment (the
intake gate must send a first-time patient to intake first).

Expected: the room opens for both sides, the countdown runs from the server
clock, chat posts both ways, and an extension follows the same
request → approve → pay → `ends_at + N` sequence as Step 8. The doctor's **End**
routes through the appointment completion (the appointment leaves the call
state), unlike the vet's SOAP path.

- [ ] **Step 12: Roll back the rail and prove the legacy rooms still work**

Stop the API, set `CONSULT_MEDIA_PROVIDER=videosdk`, rebuild, and restart.

Expected:
- The vet lobby logs the timed-room open failure, shows the fallback note, and
  **Join** opens the legacy VideoSDK room.
- `POST /api/finance/health/vet/appointments/<id>/consult-session` answers `503`
  and creates no `consult_sessions` row.
- The telemedicine timed room shows its "Use the standard room" action, and that
  action opens the unchanged legacy VideoSDK screen at `/consult/:id`.
- Set the value back to `livekit`, restart, and confirm the timed room returns.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$API/api/finance/health/vet/appointments/$APPT/consult-session" \
  -H "Authorization: Bearer $TOKEN"
```
Expected: `503`. `$TOKEN` is the signed-in owner's access token taken from the
browser session; never echo it into the shell history or a log.

- [ ] **Step 13: Record the sign-off**

Write the evidence (screenshots or screen recordings, the SQL outputs above,
and the exact build/test commands with their exit status) in the PR body. Do
not commit anything in this task. If any step failed, the slice is not done:
fix it under its own task and re-run every gate from Steps 2–3.

---

## Self-Review

**Spec coverage (Slice 2, spec line 237)**
- Package pickers at booking → Task 11 (telemedicine, `PackagePicker` on the doctor's detail screen), Task 13 (vet, picker on `book.tsx`); both read packages the provider published in Task 12 / Task 13.
- Module code starts a `consult_sessions` row pinned to its appointment → Task 3 `EnsureSession`, Task 5 `POST /telemedicine/appointments/:id/consult-session`, Task 6 vet owner/provider routes, Task 1 `uq_consult_sessions_source`; Task 14 Step 7 proves one row per appointment.
- Client `ConsultRoom` on web and native → Tasks 8–10 (`useConsultMedia.web`/`.native`, `ConsultVideo`, `ConsultRoom`), mounted by Tasks 12 and 13.
- Server timer replaces `SESSION_SECONDS` → Task 9's `sessionTimer` and Task 10's polling room; the legacy 20-minute screen survives only as the rollback path.
- Provider end/join → Task 12 doctor `room.tsx` (end through appointment completion), Task 13 vet `provider/timed-consult.tsx` (end → SOAP notes → release).
- Extension request + approve + pay → Task 10 `ExtensionSheet` over Slice 1's engine; Task 14 Steps 8 and 11 prove the approve-then-pay sequence in both modules.
- VideoSDK remains selectable as rollback → Task 7's `CONSULT_MEDIA_PROVIDER`; Task 12's "Use the standard room", Task 13's lobby and room fallbacks; Task 14 Step 12 proves 503 + no session row + legacy room reachable.
- Product intent carried from the spec → warning at 5 minutes (Task 9 phase math), media cut at 0:00 with both users still signed in (Task 10 + Task 14 Step 9), timed chat (Task 13 lobby hides camera checks; Task 10 renders chat mode), patient picks provider (Task 11 Task 13 booking), legacy 20m/30m fallbacks (untouched legacy screens).
- Slice boundary → pharmacy and lab appear only as untouched modules; no file from them is in the File Structure.

**Deliberate rulings (conflict between spec wording and the rollback constraint)**
- The spec's Client surface says patient `consult/[id].tsx` and doctor `call.tsx` are "replaced". The plan instead adds sibling rooms (`[id]/room.tsx` in both trees) and retargets only the entry links, leaving both legacy files byte-identical. Why: the same section requires VideoSDK to remain selectable, and the Global Constraint says screens are never modified destructively. Cost if wrong: two room implementations stay in the tree — that is the intended rollback, not dead code.
- The vet lobby is rewritten in place because it must bootstrap the session; its route, layout and legacy behaviour are preserved, and its Join falls through to `teleconsult.tsx` when the engine answers 503. Cost if wrong: a larger diff on one file, with the legacy room still reachable.
- The warning banner reads "ends in 5 minutes" even when the remaining time is shorter (the 5-minute cap from Slice 1); it is a warning label, not a precise countdown — the chip carries the exact clock.

**Placeholder scan**
- No `TBD`, `TODO`, "implement later", "similar to Task N", or prose-only code steps. Every code step ships the exact file content or the exact replacement lines; every verification states the command and its expected output.
- The continuation sentinel used while drafting has been removed.

**Type consistency**
- `PackagePicker` is `{ offers, selectedId, onSelect(offer) }` in Task 9 and is called that way in Task 11 and Task 13.
- `ConsultRoom({ sessionId, role, onEnd?, onBack? })` (Task 10) matches all four call sites; `onEnd` is awaited before the room refetches.
- `openVetConsultSession(appointmentId, asProvider = false)` and `openTelemedicineConsultSession(appointmentId)` live in `features/consult/api.ts` (Task 8) and are imported from the barrel by Tasks 12–13; no vet-local duplicate exists.
- `VetPackage` (Task 13) is structurally identical to `VetPackageWire` (Task 8), so `.map(offerFromVetPackage)` type-checks without a cast.
- `PackageDraft`, `nairaToKobo`, `validatePackageDraft`, `packagePayload` (Task 12) are the only form helpers used by both provider screens.
- `ConsultPackageWire.mode` is `ConsultMode`, which is what `CONSULT_MODE_LABEL` indexes.
- Booking pins match the module wires: telemedicine snake_case `package_id`; vet camelCase `packageId`/`consultMode`/`expectedTotalKobo`.
- `formatNaira` exists in both `@/utils/money` (consult picker, doctor screen) and the health constants (vet screens); both accept `{ decimals?: boolean }`.

**Test-count arithmetic**
- Task 8: 8 timer tests. Task 9: 8 `roomView` tests. Task 12: 4 package-draft tests. Total 20, which is the number every later gate expects. Task 13 adds one vet listing test to the existing `test:vet-pet` glob.

**Known risks to watch at execution**
- `backend/.env` must carry the LiveKit key/secret and `CONSULT_MEDIA_PROVIDER=livekit`; never print the file. Task 14 Step 12 flips the flag by hand and flips it back.
- A missing mobile web env makes every BFF call 401; fix it before judging Task 14 (the mobile-web login bounce is an env symptom, not a slice defect).
- The vet lobby holds Join until the open-session call settles, so a fast tap cannot race the engine into the legacy room; if that state is ever removed, Task 14 Step 7 becomes flaky.
- Dev-only clock rewrites in Task 14 Step 9 are for local Supabase only; never run them against staging or production.

