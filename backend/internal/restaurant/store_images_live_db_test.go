package restaurant

// LIVE-DB test for store images: the real update validation, the stored shape, and the
// resolved read. Skipped unless TEST_DATABASE_URL is set, and needs the banner_url
// column (migration 20271043000000).

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_StoreImages_UpdateStoresKeysAndReadsSignedURLs(t *testing.T) {
	pool := menuCartPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil).WithKYBStorage(testPresigner())

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Image Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	other := uuid.New().String()

	logoKey := storeImageKeyPrefix(restID) + "logo/aaaa1111.png"
	bannerKey := storeImageKeyPrefix(restID) + "banner/bbbb2222.webp"

	// Refused: another outlet's key, a banner key as the logo, a device URI, a script URI.
	for name, req := range map[string]UpdateRestaurantRequest{
		"another outlet's key":    {LogoURL: str(storeImageKeyPrefix(other) + "logo/x.png")},
		"banner key used as logo": {LogoURL: str(bannerKey)},
		"logo key used as banner": {BannerURL: str(logoKey)},
		"device file URI":         {LogoURL: str("file:///var/mobile/logo.png")},
		"javascript URI":          {BannerURL: str("javascript:alert(1)")},
		"svg key":                 {LogoURL: str(storeImageKeyPrefix(restID) + "logo/x.svg")},
	} {
		if _, err := svc.UpdateRestaurant(ctx, restID, owner, req); err == nil {
			t.Errorf("%s: update must be refused", name)
		}
	}
	var nLogo, nBanner *string
	_ = pool.QueryRow(ctx, `SELECT logo_url, banner_url FROM restaurants WHERE id=$1`, restID).Scan(&nLogo, &nBanner)
	if nLogo != nil || nBanner != nil {
		t.Fatalf("a refused update must not write anything, got logo=%v banner=%v", nLogo, nBanner)
	}

	// Accepted: own keys. The echo already carries signed URLs, not keys.
	got, err := svc.UpdateRestaurant(ctx, restID, owner, UpdateRestaurantRequest{LogoURL: &logoKey, BannerURL: &bannerKey})
	if err != nil {
		t.Fatalf("update with own keys: %v", err)
	}
	if got.LogoURL == nil || !strings.Contains(*got.LogoURL, "X-Amz-Signature") {
		t.Errorf("echoed logo should be a signed URL, got %v", got.LogoURL)
	}
	if got.BannerURL == nil || !strings.Contains(*got.BannerURL, "X-Amz-Signature") {
		t.Errorf("echoed banner should be a signed URL, got %v", got.BannerURL)
	}

	// What is STORED is the key — never the signed URL, which would expire.
	var sLogo, sBanner string
	if err := pool.QueryRow(ctx, `SELECT logo_url, banner_url FROM restaurants WHERE id=$1`, restID).Scan(&sLogo, &sBanner); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if sLogo != logoKey || sBanner != bannerKey {
		t.Fatalf("stored values must be the keys: logo=%q banner=%q", sLogo, sBanner)
	}

	// Every read path signs: the owner's list and the customer detail.
	mine, err := svc.ListMyRestaurants(ctx, owner)
	if err != nil || len(mine) != 1 || mine[0].BannerURL == nil || !strings.Contains(*mine[0].BannerURL, "X-Amz-Signature") {
		t.Fatalf("owner list must return a signed banner: %+v err=%v", mine, err)
	}
	detail, err := svc.GetRestaurantDetail(ctx, restID)
	if err != nil || detail.Restaurant.LogoURL == nil || !strings.Contains(*detail.Restaurant.LogoURL, "X-Amz-Signature") ||
		detail.Restaurant.BannerURL == nil || !strings.Contains(*detail.Restaurant.BannerURL, "X-Amz-Signature") {
		t.Fatalf("customer detail must return signed images: %+v err=%v", detail, err)
	}

	// A plain https link is accepted and passes through unchanged.
	link := "https://cdn.example.com/banner.jpg"
	if _, err := svc.UpdateRestaurant(ctx, restID, owner, UpdateRestaurantRequest{BannerURL: &link}); err != nil {
		t.Fatalf("link banner: %v", err)
	}
	detail, _ = svc.GetRestaurantDetail(ctx, restID)
	if detail.Restaurant.BannerURL == nil || *detail.Restaurant.BannerURL != link {
		t.Fatalf("a link must be returned as stored, got %v", detail.Restaurant.BannerURL)
	}

	// Presign: an outsider cannot mint an upload for someone else's store.
	if _, err := svc.PresignStoreImage(ctx, restID, other, "logo", "a.png", "image/png"); err == nil {
		t.Error("a non-member must not be able to presign for this store")
	}
}
