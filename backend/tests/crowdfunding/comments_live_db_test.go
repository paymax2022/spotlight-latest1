package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for campaign comments and Q&A.
//
// The mobile screen and its API client called four endpoints that were never
// built: no table, no routes, no proxy. These pin the behaviour the screen
// depends on, and the two rules that cannot be expressed as column constraints
// because both need to know about the campaign:
//   · only the campaign's creator may reply — the screen badges replies "Creator",
//     so anyone being able to reply would put a stranger's words behind the
//     campaign owner's identity;
//   · a reply may not be replied to — the feed nests exactly one level.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which .env points at the
// production pooler and these tests INSERT (scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Comment -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/crowdfunding/engage"
	"spotlight/backend/internal/testsupport"
)

// TestLiveDB_CommentRoundTrip: a posted comment comes back on the feed with the
// author's real name, and an empty feed is an empty list rather than null.
func TestLiveDB_CommentRoundTrip(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, _ := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	// An empty feed must be [] — the client maps over it, and null would crash it.
	before, err := svc.ListComments(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("list empty: %v", err)
	}
	if before == nil {
		t.Error("empty feed returned nil; the client maps over this and null crashes it")
	}
	if len(before) != 0 {
		t.Fatalf("expected an empty feed, got %d", len(before))
	}

	posted, err := svc.PostComment(ctx, campaignID, creatorID, engage.PostCommentInput{
		Body: "Will there be nationwide delivery?", IsQuestion: true,
	})
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if !posted.IsQuestion {
		t.Error("isQuestion lost on the way back; the screen splits Comments / Q&A on exactly this bit")
	}
	if !posted.IsCreator {
		t.Error("the campaign creator posting on their own campaign must be marked isCreator")
	}
	if posted.Replies == nil {
		t.Error("replies must be [] not null on a fresh comment")
	}

	after, err := svc.ListComments(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(after) != 1 {
		t.Fatalf("feed has %d comments, want 1", len(after))
	}
	if after[0].ID != posted.ID {
		t.Errorf("feed id = %q, want %q", after[0].ID, posted.ID)
	}
	if after[0].Body != "Will there be nationwide delivery?" {
		t.Errorf("body round-tripped as %q", after[0].Body)
	}
}

// TestLiveDB_CommentReplyIsCreatorOnly is the authorization rule: the same reply,
// two callers, two different answers.
func TestLiveDB_CommentReplyIsCreatorOnly(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, trackUser := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	stranger := uuid.NewString()
	trackUser(stranger)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, stranger, "cf-cmt-"+stranger+"@test.local"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	testsupport.CleanupUser(t, pool, stranger)

	comment, err := svc.PostComment(ctx, campaignID, stranger, engage.PostCommentInput{Body: "Question from a backer here"})
	if err != nil {
		t.Fatalf("post: %v", err)
	}

	// A stranger must NOT be able to reply.
	if _, err := svc.ReplyComment(ctx, comment.ID, stranger, engage.ReplyCommentInput{Body: "I am not the creator"}); !errors.Is(err, engage.ErrNotCampaignCreator) {
		t.Errorf("stranger reply err = %v, want ErrNotCampaignCreator — the screen badges replies as Creator", err)
	}

	// The creator must.
	reply, err := svc.ReplyComment(ctx, comment.ID, creatorID, engage.ReplyCommentInput{Body: "Yes, shipping starts in April."})
	if err != nil {
		t.Fatalf("creator reply: %v", err)
	}
	if !reply.IsCreator {
		t.Error("a creator's reply must carry isCreator")
	}

	// And a reply may not itself be replied to.
	if _, err := svc.ReplyComment(ctx, reply.ID, creatorID, engage.ReplyCommentInput{Body: "nested"}); !errors.Is(err, engage.ErrReplyToReply) {
		t.Errorf("reply-to-reply err = %v, want ErrReplyToReply — the feed nests exactly one level", err)
	}

	// The reply appears nested under its parent, not as a second top-level row.
	feed, err := svc.ListComments(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(feed) != 1 {
		t.Fatalf("feed has %d top-level comments, want 1 — a reply must not surface as its own comment", len(feed))
	}
	if len(feed[0].Replies) != 1 {
		t.Fatalf("replies = %d, want 1", len(feed[0].Replies))
	}
	if feed[0].Replies[0].Body != "Yes, shipping starts in April." {
		t.Errorf("reply body = %q", feed[0].Replies[0].Body)
	}
}

// TestLiveDB_CommentReportIsIdempotentAndPerViewer: reporting twice is reporting
// once, and the flag is the VIEWER's, not a global.
func TestLiveDB_CommentReportIsIdempotentAndPerViewer(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, trackUser := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	reporter := uuid.NewString()
	trackUser(reporter)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, reporter, "cf-rep-"+reporter+"@test.local"); err != nil {
		t.Fatalf("seed reporter: %v", err)
	}
	testsupport.CleanupUser(t, pool, reporter)

	comment, err := svc.PostComment(ctx, campaignID, creatorID, engage.PostCommentInput{Body: "A comment worth flagging"})
	if err != nil {
		t.Fatalf("post: %v", err)
	}

	for i := 0; i < 2; i++ {
		if err := svc.ReportComment(ctx, comment.ID, reporter); err != nil {
			t.Fatalf("report %d: %v — reporting twice must not be an error the user has to understand", i+1, err)
		}
	}
	var reports int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM cf_comment_reports WHERE comment_id = $1`, comment.ID).Scan(&reports); err != nil {
		t.Fatalf("count reports: %v", err)
	}
	if reports != 1 {
		t.Errorf("report rows = %d, want 1 — the unique index is what makes this idempotent", reports)
	}

	// The reporter sees it flagged; the creator does not. A global flag would leak
	// one person's moderation action to everybody.
	asReporter, err := svc.ListComments(ctx, campaignID, reporter)
	if err != nil {
		t.Fatalf("list as reporter: %v", err)
	}
	if !asReporter[0].Reported {
		t.Error("the reporter must see their own report reflected")
	}
	asCreator, err := svc.ListComments(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("list as creator: %v", err)
	}
	if asCreator[0].Reported {
		t.Error("reported must be per-viewer; another user's report must not show as yours")
	}

	// An anonymous reader gets the feed with nothing flagged, and no error.
	anon, err := svc.ListComments(ctx, campaignID, "")
	if err != nil {
		t.Fatalf("anonymous list: %v — comments are public and must read without a user", err)
	}
	if len(anon) != 1 || anon[0].Reported {
		t.Error("anonymous feed must render, with reported false")
	}
}

// TestLiveDB_CommentRejectsEmptyAndUnknown covers the cheap guards that would
// otherwise surface as constraint violations or 500s.
func TestLiveDB_CommentRejectsEmptyAndUnknown(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	campaignID, creatorID, _ := seedCampaign(t, ctx, pool)
	svc := engage.NewService(pool)

	if _, err := svc.PostComment(ctx, campaignID, creatorID, engage.PostCommentInput{Body: "   "}); !errors.Is(err, engage.ErrEmptyBody) {
		t.Errorf("whitespace body err = %v, want ErrEmptyBody", err)
	}
	if _, err := svc.PostComment(ctx, uuid.NewString(), creatorID, engage.PostCommentInput{Body: "on a campaign that does not exist"}); !errors.Is(err, engage.ErrCampaignNotFound) {
		t.Errorf("unknown campaign err = %v, want ErrCampaignNotFound", err)
	}
	if _, err := svc.PostComment(ctx, campaignID, "", engage.PostCommentInput{Body: "from nobody"}); !errors.Is(err, engage.ErrUnauthenticated) {
		t.Errorf("anonymous post err = %v, want ErrUnauthenticated", err)
	}
	if err := svc.ReportComment(ctx, uuid.NewString(), creatorID); !errors.Is(err, engage.ErrCommentNotFound) {
		t.Errorf("report unknown comment err = %v, want ErrCommentNotFound", err)
	}
}
