package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for campaign supporting documents.
//
// The odd one out among the campaign's nested data: milestones, budget, reward
// tiers and the beneficiary were collected by the wizard and discarded by the
// server, but documents were never collected at all — `documentLabels` on the
// draft is initialised, reset, and never written by any step. So the work was the
// whole path, and what these pin is the half that decides what ends up in a list
// a backer reads as evidence.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Document -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/crowdfunding/engage"
	"spotlight/backend/internal/testsupport"
)

func docUpload(userID string) engage.AttachDocumentInput {
	key := fmt.Sprintf("crowdfunding/documents/%s/%s.pdf", userID, uuid.NewString())
	return engage.AttachDocumentInput{
		Label:      "Hospital invoice",
		Type:       "pdf",
		URL:        "http://localhost:3000/api/crowdfunding/uploads/documents/" + uuid.NewString(),
		StorageKey: key,
		SizeBytes:  2_400_000,
	}
}

// TestLiveDB_DocumentAttachIsCreatorOnly: the list is presented as the campaign's
// own evidence, so a stranger attaching would put their document behind someone
// else's fundraiser.
func TestLiveDB_DocumentAttachIsCreatorOnly(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, trackUser := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	stranger := uuid.NewString()
	trackUser(stranger)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, stranger, "cf-doc-"+stranger+"@test.local"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	testsupport.CleanupUser(t, pool, stranger)

	if _, err := svc.AttachDocument(ctx, campaignID, stranger, docUpload(stranger)); !errors.Is(err, engage.ErrNotDocumentOwner) {
		t.Errorf("stranger attach err = %v, want ErrNotDocumentOwner", err)
	}

	got, err := svc.AttachDocument(ctx, campaignID, creatorID, docUpload(creatorID))
	if err != nil {
		t.Fatalf("creator attach: %v", err)
	}
	if got.Verified {
		t.Error("a freshly attached document must not be verified; that badge is granted by review")
	}
	// 2.4MB formatted the way the list renders it.
	if got.SizeLabel != "2.3 MB" {
		t.Errorf("sizeLabel = %q, want %q", got.SizeLabel, "2.3 MB")
	}

	list, err := svc.ListDocuments(ctx, campaignID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].ID != got.ID {
		t.Fatalf("list has %d documents, want the one just attached", len(list))
	}
}

// TestLiveDB_DocumentRejectsForeignStorageKey is the one that matters most: the
// row carries a URL the app will open, so a caller that could attach an arbitrary
// key could put any link into a list a backer reads as verified evidence.
func TestLiveDB_DocumentRejectsForeignStorageKey(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, _ := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	for _, tc := range []struct {
		name string
		key  string
	}{
		{"someone else's namespace", "registration/documents/other/abc.pdf"},
		{"no namespace at all", "abc.pdf"},
		{"an outright URL", "https://evil.example/invoice.pdf"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := docUpload(creatorID)
			in.StorageKey = tc.key
			if _, err := svc.AttachDocument(ctx, campaignID, creatorID, in); !errors.Is(err, engage.ErrMissingUpload) {
				t.Errorf("err = %v, want ErrMissingUpload — only keys the upload route produced may be attached", err)
			}
		})
	}

	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM cf_campaign_documents WHERE campaign_id=$1`, campaignID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("%d row(s) written for rejected keys", n)
	}
}

// TestLiveDB_DocumentAttachIsIdempotent: re-attaching the same object is the same
// document, not a second copy of it in the list.
func TestLiveDB_DocumentAttachIsIdempotent(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, _ := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	in := docUpload(creatorID)
	first, err := svc.AttachDocument(ctx, campaignID, creatorID, in)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	in.Label = "Hospital invoice (renamed)"
	second, err := svc.AttachDocument(ctx, campaignID, creatorID, in)
	if err != nil {
		t.Fatalf("re-attach: %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("re-attaching produced a new id (%s then %s); the same object is the same document", first.ID, second.ID)
	}
	list, _ := svc.ListDocuments(ctx, campaignID)
	if len(list) != 1 {
		t.Fatalf("list has %d documents after re-attaching the same object, want 1", len(list))
	}
	if list[0].Label != "Hospital invoice (renamed)" {
		t.Errorf("label = %q; a re-attach should update the label rather than duplicate the row", list[0].Label)
	}
}

// TestLiveDB_DocumentValidation covers the cheap guards.
func TestLiveDB_DocumentValidation(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, _ := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	blank := docUpload(creatorID)
	blank.Label = "   "
	if _, err := svc.AttachDocument(ctx, campaignID, creatorID, blank); !errors.Is(err, engage.ErrEmptyLabel) {
		t.Errorf("blank label err = %v, want ErrEmptyLabel", err)
	}
	badType := docUpload(creatorID)
	badType.Type = "spreadsheet"
	if _, err := svc.AttachDocument(ctx, campaignID, creatorID, badType); !errors.Is(err, engage.ErrBadDocumentType) {
		t.Errorf("bad type err = %v, want ErrBadDocumentType", err)
	}
	noURL := docUpload(creatorID)
	noURL.URL = ""
	if _, err := svc.AttachDocument(ctx, campaignID, creatorID, noURL); !errors.Is(err, engage.ErrMissingUpload) {
		t.Errorf("missing url err = %v, want ErrMissingUpload", err)
	}
	if _, err := svc.AttachDocument(ctx, campaignID, "", docUpload(creatorID)); !errors.Is(err, engage.ErrUnauthenticated) {
		t.Errorf("anonymous attach err = %v, want ErrUnauthenticated", err)
	}
}
