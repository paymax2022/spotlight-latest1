package top5events

// DB-free tests for the final-review fixes (events-social):
//   - F1: with the social flag off, the event read is the original 11-column
//     select with no event_likes join.
//   - F2: create ignores client-owned social fields; venue coordinates are
//     range-checked; EventPatch carries nullable venue fields with clear-on-null.
//   - F3: a stored banner is re-validated before it is returned; the migration
//     does not grant banner_url to authenticated.
//   - F4: an organiser is an account with at least one event.
//
// Every Service here is built without a pool. A path that reached the database
// would panic on the nil pool, so a pass also proves the check runs first.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/platform/r2"
)

func f64p(v float64) *float64 { return &v }
func sp(v string) *string     { return &v }

// originalGetEventQuery is the GetEvent select before the events-social branch,
// byte for byte.
const originalGetEventQuery = `SELECT id, organiser_id, title, COALESCE(description,''), venue, state, COALESCE(category,''), starts_at, ends_at, fee_bps, created_at FROM events WHERE id=$1`

func TestEventByIDQuery_FlagOffIsOriginalSelect(t *testing.T) {
	off := (&Service{}).eventByIDQuery()
	if off != originalGetEventQuery {
		t.Fatalf("flag-off query =\n%s\nwant the original select\n%s", off, originalGetEventQuery)
	}
	for _, col := range []string{"banner_url", "venue_lat", "venue_lng", "venue_place_id", "like_count", "event_likes"} {
		if strings.Contains(off, col) {
			t.Errorf("flag-off query reads %q; it must not touch events-social columns", col)
		}
	}

	on := (&Service{socialReads: true}).eventByIDQuery()
	for _, col := range []string{"banner_url", "venue_lat", "venue_lng", "venue_place_id", "like_count", "event_likes"} {
		if !strings.Contains(on, col) {
			t.Errorf("flag-on query is missing %q", col)
		}
	}
}

// countingRow records how many destinations Scan was given.
type countingRow struct{ n int }

func (r *countingRow) Scan(dest ...any) error { r.n = len(dest); return nil }

func TestScanLegacyEvent_ScansElevenColumns(t *testing.T) {
	row := &countingRow{}
	if _, err := scanLegacyEvent(row); err != nil {
		t.Fatalf("scanLegacyEvent: %v", err)
	}
	if row.n != 11 {
		t.Fatalf("legacy scan took %d destinations, want 11 (the original column list)", row.n)
	}
}

func TestSocialReadsDefaultOff(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	if svc.socialReads {
		t.Fatal("a new Service must read with the social flag off")
	}
	if !svc.EnableSocialReads().socialReads {
		t.Fatal("EnableSocialReads did not turn the social read path on")
	}
}

func TestPrepareNewEvent_IgnoresClientSocialFields(t *testing.T) {
	in := Event{
		Title: "Show", BannerURL: sp("https://evil.test/x.png"), LikeCount: 999, Liked: true,
		VenueLat: f64p(6.5), VenueLng: f64p(3.4), VenuePlaceID: sp("place-1"),
	}

	off, err := prepareNewEvent(in, false)
	if err != nil {
		t.Fatalf("flag off: %v", err)
	}
	if off.BannerURL != nil || off.LikeCount != 0 || off.Liked {
		t.Errorf("flag off: banner/like fields not cleared: %+v", off)
	}
	if off.VenueLat != nil || off.VenueLng != nil || off.VenuePlaceID != nil {
		t.Errorf("flag off: venue fields are not stored, so must not be echoed: %+v", off)
	}

	on, err := prepareNewEvent(in, true)
	if err != nil {
		t.Fatalf("flag on: %v", err)
	}
	if on.BannerURL != nil || on.LikeCount != 0 || on.Liked {
		t.Errorf("flag on: banner/like fields not cleared: %+v", on)
	}
	if on.VenueLat == nil || *on.VenueLat != 6.5 || on.VenueLng == nil || *on.VenueLng != 3.4 ||
		on.VenuePlaceID == nil || *on.VenuePlaceID != "place-1" {
		t.Errorf("flag on: venue fields must be kept (they are written): %+v", on)
	}

	blank, err := prepareNewEvent(Event{VenuePlaceID: sp("  ")}, true)
	if err != nil || blank.VenuePlaceID != nil {
		t.Errorf("blank place id = %v (err %v), want nil", blank.VenuePlaceID, err)
	}
}

func TestPrepareNewEvent_RangeChecksCoordinates(t *testing.T) {
	for name, e := range map[string]Event{
		"lat too high": {VenueLat: f64p(90.01)},
		"lat too low":  {VenueLat: f64p(-90.01)},
		"lng too high": {VenueLng: f64p(180.01)},
		"lng too low":  {VenueLng: f64p(-180.01)},
	} {
		if _, err := prepareNewEvent(e, true); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: err = %v, want ErrValidation", name, err)
		}
	}
	for name, e := range map[string]Event{
		"poles and antimeridian": {VenueLat: f64p(-90), VenueLng: f64p(180)},
		"null island":            {VenueLat: f64p(0), VenueLng: f64p(0)},
	} {
		if _, err := prepareNewEvent(e, true); err != nil {
			t.Errorf("%s: err = %v, want nil", name, err)
		}
	}
}

func TestCreateEvent_RejectsBadCoordinatesBeforeWrite(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil).EnableSocialReads()
	_, err := svc.CreateEvent(context.Background(), uuid.New().String(), Event{
		Title: "x", StartsAt: time.Now(), EndsAt: time.Now().Add(time.Hour), VenueLat: f64p(91), VenueLng: f64p(3),
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("err = %v, want ErrValidation", err)
	}
}

func TestEventPatch_VenueFieldsThreeStates(t *testing.T) {
	cases := []struct {
		name                 string
		body                 string
		latSet, lngSet, pSet bool
		lat, lng             *float64
		place                *string
	}{
		{"absent", `{"title":"t"}`, false, false, false, nil, nil, nil},
		{"null clears", `{"venue_lat":null,"venue_lng":null,"venue_place_id":null}`, true, true, true, nil, nil, nil},
		{"values", `{"venue_lat":6.5,"venue_lng":-3.25,"venue_place_id":"abc"}`, true, true, true, f64p(6.5), f64p(-3.25), sp("abc")},
		{"zero is a value", `{"venue_lat":0,"venue_lng":0}`, true, true, false, f64p(0), f64p(0), nil},
	}
	for _, tc := range cases {
		var p EventPatch
		if err := json.Unmarshal([]byte(tc.body), &p); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if p.VenueLatSet != tc.latSet || p.VenueLngSet != tc.lngSet || p.VenuePlaceIDSet != tc.pSet {
			t.Errorf("%s: set flags = %v/%v/%v", tc.name, p.VenueLatSet, p.VenueLngSet, p.VenuePlaceIDSet)
		}
		if (p.VenueLat == nil) != (tc.lat == nil) || (p.VenueLat != nil && *p.VenueLat != *tc.lat) {
			t.Errorf("%s: VenueLat = %v", tc.name, p.VenueLat)
		}
		if (p.VenueLng == nil) != (tc.lng == nil) || (p.VenueLng != nil && *p.VenueLng != *tc.lng) {
			t.Errorf("%s: VenueLng = %v", tc.name, p.VenueLng)
		}
		if (p.VenuePlaceID == nil) != (tc.place == nil) || (p.VenuePlaceID != nil && *p.VenuePlaceID != *tc.place) {
			t.Errorf("%s: VenuePlaceID = %v", tc.name, p.VenuePlaceID)
		}
	}

	// The existing fields still decode.
	var p EventPatch
	if err := json.Unmarshal([]byte(`{"title":"T","venue":"Hall","starts_at":"2027-01-02T15:04:05Z"}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Title == nil || *p.Title != "T" || p.Venue == nil || *p.Venue != "Hall" || p.StartsAt == nil {
		t.Errorf("existing fields lost: %+v", p)
	}

	for _, bad := range []string{`{"venue_lat":"6.5"}`, `{"venue_lng":true}`, `{"venue_place_id":5}`} {
		var q EventPatch
		if err := json.Unmarshal([]byte(bad), &q); err == nil {
			t.Errorf("%s: want a decode error", bad)
		}
	}
}

func TestUpdateEvent_RangeChecksCoordinatesBeforeDB(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil).EnableSocialReads()
	for name, p := range map[string]EventPatch{
		"lat 91":   {VenueLat: f64p(91), VenueLatSet: true},
		"lng -181": {VenueLng: f64p(-181), VenueLngSet: true},
	} {
		if _, err := svc.UpdateEvent(context.Background(), uuid.New().String(), uuid.New().String(), p); !errors.Is(err, ErrValidation) {
			t.Errorf("%s: err = %v, want ErrValidation", name, err)
		}
	}
}

func TestLifecycleStatus_ValidationIs400(t *testing.T) {
	if got := lifecycleStatus(ErrValidation); got != http.StatusBadRequest {
		t.Fatalf("lifecycleStatus(ErrValidation) = %d, want 400", got)
	}
}

func TestViewBanner_RevalidatesStoredValue(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil).WithStorage(r2.New(r2.Config{
		AccountEndpoint: "https://acct.r2.cloudflarestorage.com",
		Bucket:          "test-bucket",
		AccessKeyID:     "AKIDEXAMPLE",
		SecretAccessKey: "secretsecretsecretsecretsecretsecretsecret",
		Region:          "auto",
	}))
	me := uuid.New().String()
	other := uuid.New().String()

	for name, v := range map[string]string{
		"another organiser's key": "organiser/" + other + "/banner/a.png",
		"javascript scheme":       "javascript:alert(1)",
		"data scheme":             "data:image/png;base64,AAAA",
		"svg key":                 "organiser/" + me + "/banner/a.svg",
		"traversal":               "organiser/" + me + "/banner/../../" + other + "/banner/a.png",
	} {
		if got := svc.viewBanner(me, sp(v)); got != nil {
			t.Errorf("%s: viewBanner = %q, want nil", name, *got)
		}
	}
	if got := svc.viewBanner(me, sp("https://cdn.test/b.png")); got == nil || *got != "https://cdn.test/b.png" {
		t.Errorf("https link: viewBanner = %v, want it as stored", got)
	}
	got := svc.viewBanner(me, sp("organiser/"+me+"/banner/a.png"))
	if got == nil || !strings.Contains(*got, "test-bucket") {
		t.Errorf("own key: viewBanner = %v, want a signed URL", got)
	}
}

func TestOrganiserGate_RequiresAnEvent(t *testing.T) {
	norm := strings.Join(strings.Fields(isOrganiserQuery), " ")
	if !strings.Contains(norm, "FROM events") || !strings.Contains(norm, "organiser_id = $1") {
		t.Errorf("isOrganiserQuery = %q, want an EXISTS over events.organiser_id", norm)
	}
	if strings.Contains(norm, "auth.users") {
		t.Errorf("isOrganiserQuery = %q: any account is not an organiser", norm)
	}
	q := strings.Join(strings.Fields(organiserProfileQuery), " ")
	if !strings.Contains(q, "FROM events ev WHERE ev.organiser_id = u.id") {
		t.Errorf("organiserProfileQuery does not gate on the account having an event:\n%s", q)
	}
}

func TestFollowAndGetOrganiser_RejectBeforeDB(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	me := uuid.New().String()
	if _, err := svc.FollowOrganiser(context.Background(), me, "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Errorf("follow malformed id: err = %v, want ErrNotFound", err)
	}
	if _, err := svc.FollowOrganiser(context.Background(), me, me); !errors.Is(err, ErrValidation) {
		t.Errorf("self-follow: err = %v, want ErrValidation", err)
	}
	if _, err := svc.GetOrganiser(context.Background(), me, "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Errorf("get malformed id: err = %v, want ErrNotFound", err)
	}
}

// TestMigrationEventsSocial_NoBannerGrantToAuthenticated is the static half of
// R42: the authenticated INSERT and UPDATE column grants on organiser_profiles
// list display_name, bio and updated_at, never banner_url. The live half is in
// migration_live_db_test.go (has_column_privilege).
func TestMigrationEventsSocial_NoBannerGrantToAuthenticated(t *testing.T) {
	b, err := os.ReadFile("../../../supabase/migrations/20271045000000_events_social.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	grants := regexp.MustCompile(`(?is)GRANT\s+(INSERT|UPDATE)\s*\(([^)]*)\)\s*ON\s+public\.organiser_profiles\s+TO\s+authenticated`).
		FindAllStringSubmatch(string(b), -1)
	if len(grants) != 2 {
		t.Fatalf("found %d column grants on organiser_profiles, want 2 (INSERT and UPDATE)", len(grants))
	}
	for _, g := range grants {
		cols := strings.Join(strings.Fields(g[2]), " ")
		if strings.Contains(cols, "banner_url") {
			t.Errorf("GRANT %s (%s) gives authenticated banner_url; the backend is the only banner writer", g[1], cols)
		}
		for _, want := range []string{"display_name", "bio", "updated_at"} {
			if !strings.Contains(cols, want) {
				t.Errorf("GRANT %s (%s) lost %s", g[1], cols, want)
			}
		}
	}
}
