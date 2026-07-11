package connectfeed

import "testing"

func strptr(s string) *string { return &s }

// Comment threading: replies attach to their top-level parent in order; top-level
// comments remain in their original chronological order.
func TestBuildThreads_NestsRepliesUnderParent(t *testing.T) {
	comments := []Comment{
		{ID: "c1", PostID: "p", Body: "top one"},
		{ID: "c2", PostID: "p", Body: "reply to c1", ParentCommentID: strptr("c1")},
		{ID: "c3", PostID: "p", Body: "top two"},
		{ID: "c4", PostID: "p", Body: "another reply to c1", ParentCommentID: strptr("c1")},
		{ID: "c5", PostID: "p", Body: "reply to c3", ParentCommentID: strptr("c3")},
	}
	nodes := BuildThreads(comments)

	if len(nodes) != 2 {
		t.Fatalf("expected 2 top-level threads, got %d", len(nodes))
	}
	if nodes[0].ID != "c1" || nodes[1].ID != "c3" {
		t.Fatalf("top-level order wrong: %q, %q", nodes[0].ID, nodes[1].ID)
	}
	if len(nodes[0].Replies) != 2 || nodes[0].Replies[0].ID != "c2" || nodes[0].Replies[1].ID != "c4" {
		t.Fatalf("c1 replies wrong: %+v", nodes[0].Replies)
	}
	if len(nodes[1].Replies) != 1 || nodes[1].Replies[0].ID != "c5" {
		t.Fatalf("c3 replies wrong: %+v", nodes[1].Replies)
	}
}

// A reply whose parent is not present is defensively promoted to top-level (never
// dropped).
func TestBuildThreads_OrphanReplyPromoted(t *testing.T) {
	comments := []Comment{
		{ID: "c1", PostID: "p", Body: "top"},
		{ID: "c9", PostID: "p", Body: "orphan", ParentCommentID: strptr("missing")},
	}
	nodes := BuildThreads(comments)
	if len(nodes) != 2 {
		t.Fatalf("orphan reply must be promoted, got %d nodes", len(nodes))
	}
}
