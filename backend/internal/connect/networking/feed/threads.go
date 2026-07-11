package connectfeed

// Reaction toggle decisions — pure, so the "one reaction per user/post" invariant
// is unit-testable without a database. The DB UNIQUE(post_id,user_id) constraint is
// the hard guarantee; this function decides which single-row mutation to apply so
// that at most one row can ever exist for a (post,user) pair.
const (
	reactInsert = "insert" // no prior reaction → create one
	reactDelete = "delete" // same reaction again → toggle it off
	reactUpdate = "update" // different reaction → change the single row in place
)

func reactionAction(existing string, hasExisting bool, requested string) string {
	switch {
	case !hasExisting:
		return reactInsert
	case existing == requested:
		return reactDelete
	default:
		return reactUpdate
	}
}

// ThreadNode is a top-level comment with its direct replies (single-level threading,
// matching parent_comment_id). Pure projection of a flat comment list.
type ThreadNode struct {
	Comment
	Replies []Comment `json:"replies"`
}

// BuildThreads groups a flat, chronologically-ordered comment slice into threads:
// top-level comments (parent_comment_id == nil) with their replies attached in order.
// Replies whose parent is absent from the slice are treated as top-level (defensive).
func BuildThreads(comments []Comment) []ThreadNode {
	index := make(map[string]int) // comment id → position in nodes
	var nodes []ThreadNode

	// First pass: create nodes for top-level comments.
	for _, c := range comments {
		if c.ParentCommentID == nil {
			index[c.ID] = len(nodes)
			nodes = append(nodes, ThreadNode{Comment: c})
		}
	}
	// Second pass: attach replies to their parent (or promote orphans to top-level).
	for _, c := range comments {
		if c.ParentCommentID == nil {
			continue
		}
		if pos, ok := index[*c.ParentCommentID]; ok {
			nodes[pos].Replies = append(nodes[pos].Replies, c)
		} else {
			index[c.ID] = len(nodes)
			nodes = append(nodes, ThreadNode{Comment: c})
		}
	}
	return nodes
}
