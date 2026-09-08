package extranet

// LIVE-DB tests for the Airbnb-style listing detail patch (service.go's
// UpdateDetails) and property photo uploads (property_photos.go) — the gap
// that made a self-listed (DIRECT-rail) property unable to carry a location
// pin, amenities, house rules, cancellation policy, or a single photo.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func mediaPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping property media live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

// fakePresigner satisfies both PhotoPresigner and PhotoReadPresigner without a
// real R2 account — PresignPut/PresignGet just echo the key so tests can
// assert on the round trip without any network dependency.
type fakePresigner struct{ configured bool }

func (f fakePresigner) PresignPut(key, _ string, _ time.Duration) (string, error) {
	return "https://upload.test/" + key, nil
}
func (f fakePresigner) PresignGet(key string, _ time.Duration) (string, error) {
	return "https://read.test/" + key, nil
}
func (f fakePresigner) Configured() bool { return f.configured }

type mediaFixture struct {
	svc      *Service
	pool     *pgxpool.Pool
	owner    string
	property string
}

func newMediaFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) mediaFixture {
	t.Helper()
	owner := uuid.New().String()
	property := uuid.New().String()

	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_property (id, source_rail, supplier_code, supplier_property_ref, name, address, city, star_rating, property_type)
		VALUES ($1, 'DIRECT', 'self', $2, 'STF Media Test Hotel', '1 St', 'Lagos', 4, 'hotel')`,
		property, uuid.New().String()); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_hotelier_profile (user_id, property_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`,
		owner, property); err != nil {
		t.Fatalf("seed owner grant: %v", err)
	}

	svc := NewService(NewRepository(pool), NewAuthZ(pool), nil, noopStaffInviteMailer{}, "https://admin.test")
	svc.WithPhotoPresigner(fakePresigner{configured: true})

	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM public.stays_property_photo WHERE property_id = $1`, property)
		pool.Exec(bg, `DELETE FROM public.stays_hotelier_profile WHERE property_id = $1`, property)
		pool.Exec(bg, `DELETE FROM public.stays_property WHERE id = $1`, property)
		pool.Exec(bg, `DELETE FROM auth.users WHERE id = $1`, owner)
	})
	return mediaFixture{svc: svc, pool: pool, owner: owner, property: property}
}

func ptr[T any](v T) *T { return &v }

// --- UpdateDetails ---

func TestLiveDB_UpdateDetailsAppliesLocationAmenitiesAndPolicies(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)

	err := f.svc.UpdateDetails(ctx, f.owner, f.property, PropertyDetailsPatch{
		Lat: ptr(6.4531), Lng: ptr(3.3958),
		Amenities:          ptr([]string{" WiFi ", "Pool", "wifi"}), // trims + case-insensitive dedupes
		HouseRules:         ptr("No smoking indoors."),
		CancellationPolicy: ptr("STRICT"),
		CheckInFrom:        ptr("15:00"),
		CheckOutUntil:      ptr("11:00"),
		ContactPhone:       ptr("+2348012345678"),
		ContactEmail:       ptr("front-desk@stfmedia.test"),
	})
	if err != nil {
		t.Fatalf("UpdateDetails: %v", err)
	}

	prop, err := f.svc.GetProperty(ctx, f.owner, f.property)
	if err != nil {
		t.Fatalf("GetProperty: %v", err)
	}
	if prop.Lat != 6.4531 || prop.Lng != 3.3958 {
		t.Errorf("lat/lng = (%v,%v), want (6.4531,3.3958)", prop.Lat, prop.Lng)
	}
	if len(prop.Amenities) != 2 {
		t.Errorf("amenities = %v, want 2 deduplicated entries", prop.Amenities)
	}
	if prop.HouseRules != "No smoking indoors." {
		t.Errorf("house_rules = %q", prop.HouseRules)
	}
	if prop.CancellationPolicy != "STRICT" {
		t.Errorf("cancellation_policy = %q, want STRICT", prop.CancellationPolicy)
	}
	if prop.CheckInFrom != "15:00" || prop.CheckOutUntil != "11:00" {
		t.Errorf("check-in/out = %s/%s, want 15:00/11:00", prop.CheckInFrom, prop.CheckOutUntil)
	}
	if prop.ContactPhone == "" || prop.ContactEmail == "" {
		t.Error("contact_phone/contact_email were not persisted")
	}

	// A field NOT sent in a second patch must be left untouched.
	if err := f.svc.UpdateDetails(ctx, f.owner, f.property, PropertyDetailsPatch{HouseRules: ptr("Quiet hours after 10pm.")}); err != nil {
		t.Fatalf("UpdateDetails (partial): %v", err)
	}
	prop2, err := f.svc.GetProperty(ctx, f.owner, f.property)
	if err != nil {
		t.Fatalf("GetProperty: %v", err)
	}
	if prop2.CancellationPolicy != "STRICT" {
		t.Errorf("a partial patch changed cancellation_policy to %q — untouched fields must survive", prop2.CancellationPolicy)
	}
	if prop2.HouseRules != "Quiet hours after 10pm." {
		t.Errorf("house_rules = %q, want the second patch's value", prop2.HouseRules)
	}
}

func TestLiveDB_UpdateDetailsRejectsInvalidInput(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)

	cases := []struct {
		name  string
		patch PropertyDetailsPatch
	}{
		{"lat without lng", PropertyDetailsPatch{Lat: ptr(6.45)}},
		{"lat out of range", PropertyDetailsPatch{Lat: ptr(200.0), Lng: ptr(3.0)}},
		{"bad cancellation policy", PropertyDetailsPatch{CancellationPolicy: ptr("WHATEVER")}},
		{"bad check-in format", PropertyDetailsPatch{CheckInFrom: ptr("3pm")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := f.svc.UpdateDetails(ctx, f.owner, f.property, tc.patch); err == nil {
				t.Error("expected a validation error, got nil")
			}
		})
	}
}

func TestLiveDB_UpdateDetailsRequiresAnActiveGrant(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)

	stranger := uuid.New().String()
	if err := f.svc.UpdateDetails(ctx, stranger, f.property, PropertyDetailsPatch{HouseRules: ptr("x")}); err != ErrForbidden {
		t.Errorf("UpdateDetails by a non-staff caller = %v, want ErrForbidden", err)
	}
}

// --- photos ---

func TestLiveDB_PhotoUploadRoundTripAndCoverInvariant(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)

	uploadURL, key, err := f.svc.PresignPhotoUpload(ctx, f.owner, f.property, "image/jpeg")
	if err != nil {
		t.Fatalf("PresignPhotoUpload: %v", err)
	}
	if uploadURL == "" || key == "" {
		t.Fatal("presign returned an empty URL or key")
	}
	if got := key[:len("stays/"+f.property+"/")]; got != "stays/"+f.property+"/" {
		t.Errorf("storage_key = %q, want it scoped under stays/%s/", key, f.property)
	}

	// First photo becomes the cover automatically.
	photo1, err := f.svc.ConfirmPhotoUpload(ctx, f.owner, f.property, key, "", "Lobby")
	if err != nil {
		t.Fatalf("ConfirmPhotoUpload: %v", err)
	}
	if !photo1.IsCover {
		t.Error("the first photo on a property must be its cover")
	}
	if photo1.URL == "" {
		t.Error("photo URL was not presigned")
	}

	_, key2, _ := f.svc.PresignPhotoUpload(ctx, f.owner, f.property, "image/png")
	photo2, err := f.svc.ConfirmPhotoUpload(ctx, f.owner, f.property, key2, "", "Pool")
	if err != nil {
		t.Fatalf("ConfirmPhotoUpload (2nd): %v", err)
	}
	if photo2.IsCover {
		t.Error("a second photo must not silently become the cover")
	}

	// Explicitly re-cover to the second photo — the first must be un-covered.
	if err := f.svc.SetCoverPhoto(ctx, f.owner, f.property, photo2.ID); err != nil {
		t.Fatalf("SetCoverPhoto: %v", err)
	}
	list, err := f.svc.ListPhotos(ctx, f.owner, f.property)
	if err != nil {
		t.Fatalf("ListPhotos: %v", err)
	}
	covers := 0
	for _, p := range list {
		if p.IsCover {
			covers++
			if p.ID != photo2.ID {
				t.Errorf("cover is %s, want %s", p.ID, photo2.ID)
			}
		}
	}
	if covers != 1 {
		t.Errorf("cover count = %d, want exactly 1", covers)
	}

	// Deleting the current cover promotes the remaining photo.
	if err := f.svc.DeletePhoto(ctx, f.owner, f.property, photo2.ID); err != nil {
		t.Fatalf("DeletePhoto: %v", err)
	}
	list2, err := f.svc.ListPhotos(ctx, f.owner, f.property)
	if err != nil {
		t.Fatalf("ListPhotos (after delete): %v", err)
	}
	if len(list2) != 1 || !list2[0].IsCover {
		t.Errorf("after deleting the cover, the one remaining photo must become the cover; got %+v", list2)
	}
}

func TestLiveDB_ConfirmPhotoUploadRejectsAForeignStorageKey(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)

	// A key scoped to a DIFFERENT property must never be attachable here — this
	// is what stops one property's photo confirm from claiming another's upload.
	foreignKey := "stays/" + uuid.New().String() + "/x.jpg"
	if _, err := f.svc.ConfirmPhotoUpload(ctx, f.owner, f.property, foreignKey, "", ""); err == nil {
		t.Error("confirming a foreign storage_key succeeded")
	}
}

func TestLiveDB_PhotoUploadRequiresAnActiveGrant(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)

	stranger := uuid.New().String()
	if _, _, err := f.svc.PresignPhotoUpload(ctx, stranger, f.property, "image/jpeg"); err != ErrForbidden {
		t.Errorf("PresignPhotoUpload by a non-staff caller = %v, want ErrForbidden", err)
	}
}

func TestLiveDB_PhotoUploadFailsClosedWithoutAPresigner(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)
	f.svc.WithPhotoPresigner(fakePresigner{configured: false})

	if _, _, err := f.svc.PresignPhotoUpload(ctx, f.owner, f.property, "image/jpeg"); err != ErrUploadsNotConfigured {
		t.Errorf("PresignPhotoUpload with no configured presigner = %v, want ErrUploadsNotConfigured", err)
	}
}

// --- go-live checklist picks up photos + policies ---

func TestLiveDB_VerificationChecklistReflectsRealPhotosAndPolicies(t *testing.T) {
	pool := mediaPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newMediaFixture(t, ctx, pool)

	vs, err := f.svc.buildVerificationStatus(ctx, f.property)
	if err != nil {
		t.Fatalf("buildVerificationStatus: %v", err)
	}
	find := func(key string) VerificationChecklistItem {
		for _, item := range vs.Checklist {
			if item.Key == key {
				return item
			}
		}
		t.Fatalf("no checklist item %q", key)
		return VerificationChecklistItem{}
	}
	if find("photos").Status == VerifApproved {
		t.Error("photos should not read approved with zero photos uploaded")
	}
	if find("policies").Status == VerifApproved {
		t.Error("policies should not read approved before house_rules is ever set")
	}

	if err := f.svc.UpdateDetails(ctx, f.owner, f.property, PropertyDetailsPatch{HouseRules: ptr("Be quiet after 10pm.")}); err != nil {
		t.Fatalf("UpdateDetails: %v", err)
	}
	for i := 0; i < minPhotosForGoLive; i++ {
		_, key, _ := f.svc.PresignPhotoUpload(ctx, f.owner, f.property, "image/jpeg")
		if _, err := f.svc.ConfirmPhotoUpload(ctx, f.owner, f.property, key, "", ""); err != nil {
			t.Fatalf("ConfirmPhotoUpload #%d: %v", i, err)
		}
	}

	vs2, err := f.svc.buildVerificationStatus(ctx, f.property)
	if err != nil {
		t.Fatalf("buildVerificationStatus (after): %v", err)
	}
	if find2 := func(key string) VerificationChecklistItem {
		for _, item := range vs2.Checklist {
			if item.Key == key {
				return item
			}
		}
		t.Fatalf("no checklist item %q", key)
		return VerificationChecklistItem{}
	}; find2("photos").Status != VerifApproved {
		t.Errorf("photos = %s, want approved after uploading %d", find2("photos").Status, minPhotosForGoLive)
	} else if find2("policies").Status != VerifApproved {
		t.Errorf("policies = %s, want approved once house_rules is set", find2("policies").Status)
	}
}
