package connectconsole

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ErrContestNotFound is returned for an unknown contest id.
var ErrContestNotFound = errors.New("connect: contest not found")

// ContestSummary mirrors frontend-admin VotingContestSummary. integrity_score and flags_open are null:
// no integrity scoring or flag store exists yet. The two money fields are null without connect.gifting.view.
type ContestSummary struct {
	ID                 string  `json:"id"`
	Title              string  `json:"title"`
	Status             string  `json:"status"`
	PaidVotes          int64   `json:"paid_votes"`
	FreeVotes          int64   `json:"free_votes"`
	PaidVoteVolumeKobo *int64  `json:"paid_vote_volume_kobo"`
	IntegrityScore     *int    `json:"integrity_score"`
	FlagsOpen          *int    `json:"flags_open"`
	StartsAt           *string `json:"starts_at"`
	EndsAt             *string `json:"ends_at"`
}

// ContestEntrant is one roster contestant or poll option with its tallies.
type ContestEntrant struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	PaidVotes int64  `json:"paid_votes"`
	FreeVotes int64  `json:"free_votes"`
	TallyKobo *int64 `json:"tally_kobo"`
}

// ContestDetail mirrors frontend-admin VotingContestDetail. flags is always [] (no integrity-flag store).
type ContestDetail struct {
	ContestSummary
	Entrants []ContestEntrant `json:"entrants"`
	// EntrantsTruncated is true when the contest has more than maxEntrants distinct options; totals still count every vote.
	EntrantsTruncated bool          `json:"entrants_truncated"`
	Flags             []interface{} `json:"flags"`
	Notes             *string       `json:"notes"`
}

type contestRow struct {
	ID, Title, Status string
	PaidVotes         int64
	FreeVotes         int64
	PaidKobo          int64
	OpensAt, ClosesAt *time.Time
}

// maxEntrants bounds the entrant list: a poll contest accepts free-form labels, so distinct options are unbounded.
const maxEntrants = 500

type rosterEntry struct{ ID, Name string }
type tally struct{ Paid, Free, Kobo int64 }

var contestStatuses = map[string]bool{"all": true, "scheduled": true, "live": true, "closed": true, "finalized": true}

func parseContestStatus(s string) (string, bool) {
	if s == "" {
		return "all", true
	}
	return s, contestStatuses[s]
}

// contestStatusSQL derives the console status (scheduled / live / closed) from the stored status and
// the open/close window. 'finalized' has no stored equivalent and never matches.
const contestStatusSQL = `CASE
	WHEN c.status = 'draft' THEN 'scheduled'
	WHEN c.status = 'closed' OR (c.closes_at IS NOT NULL AND c.closes_at < now()) THEN 'closed'
	WHEN c.opens_at IS NULL OR c.opens_at <= now() THEN 'live'
	ELSE 'scheduled' END`

func ts(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func contestSummaryOf(r contestRow) ContestSummary {
	paid := r.PaidKobo
	return ContestSummary{
		ID: r.ID, Title: r.Title, Status: r.Status, PaidVotes: r.PaidVotes, FreeVotes: r.FreeVotes,
		PaidVoteVolumeKobo: &paid, StartsAt: ts(r.OpensAt), EndsAt: ts(r.ClosesAt),
		// IntegrityScore and FlagsOpen stay nil: nothing stores them.
	}
}

// mergeEntrants lists every roster contestant (even with no votes) plus any voted option that is not on
// the roster (a plain-poll label), ordered by total votes then name.
func mergeEntrants(roster []rosterEntry, tallies map[string]tally) []ContestEntrant {
	out := make([]ContestEntrant, 0, len(roster)+len(tallies))
	seen := map[string]bool{}
	add := func(id, name string) {
		t := tallies[id]
		kobo := t.Kobo
		out = append(out, ContestEntrant{ID: id, Name: name, PaidVotes: t.Paid, FreeVotes: t.Free, TallyKobo: &kobo})
		seen[id] = true
	}
	for _, r := range roster {
		add(r.ID, r.Name)
	}
	for id := range tallies {
		if !seen[id] {
			add(id, id)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		ti, tj := out[i].PaidVotes+out[i].FreeVotes, out[j].PaidVotes+out[j].FreeVotes
		if ti != tj {
			return ti > tj
		}
		return out[i].Name < out[j].Name
	})
	return out
}

const contestSelect = `SELECT c.id::text, c.title, ` + contestStatusSQL + `, c.opens_at, c.closes_at,
	COALESCE(v.paid, 0)::bigint, COALESCE(v.free, 0)::bigint, COALESCE(v.kobo, 0)::bigint
	FROM connect_contests c
	LEFT JOIN LATERAL (
	  SELECT SUM(quantity) FILTER (WHERE paid) AS paid, SUM(quantity) FILTER (WHERE NOT paid) AS free,
	         SUM(amount_kobo) FILTER (WHERE paid) AS kobo
	    FROM connect_votes WHERE contest_id = c.id
	) v ON true`

func scanContest(row pgx.Row) (contestRow, error) {
	var r contestRow
	err := row.Scan(&r.ID, &r.Title, &r.Status, &r.OpensAt, &r.ClosesAt, &r.PaidVotes, &r.FreeVotes, &r.PaidKobo)
	return r, err
}

// ListContests returns contests newest first, filtered by derived status, plus has_more.
func (s *Service) ListContests(ctx context.Context, status string, limit int) ([]ContestSummary, bool, error) {
	rows, err := s.db.Query(ctx, contestSelect+`
		WHERE ($1 = 'all' OR `+contestStatusSQL+` = $1)
		ORDER BY c.created_at DESC, c.id DESC LIMIT $2`, status, limit+1)
	if err != nil {
		return nil, false, fmt.Errorf("connect: list contests: %w", err)
	}
	defer rows.Close()
	out := make([]ContestSummary, 0, limit)
	for rows.Next() {
		r, err := scanContest(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, contestSummaryOf(r))
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(out) > limit {
		return out[:limit], true, nil
	}
	return out, false, nil
}

// GetContest returns one contest with its entrants, or ErrContestNotFound.
func (s *Service) GetContest(ctx context.Context, id string) (*ContestDetail, error) {
	r, err := scanContest(s.db.QueryRow(ctx, contestSelect+` WHERE c.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrContestNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get contest: %w", err)
	}
	tallies := map[string]tally{}
	trows, err := s.db.Query(ctx, `SELECT option_ref, COALESCE(SUM(quantity) FILTER (WHERE paid), 0)::bigint,
		COALESCE(SUM(quantity) FILTER (WHERE NOT paid), 0)::bigint, COALESCE(SUM(amount_kobo) FILTER (WHERE paid), 0)::bigint
		FROM connect_votes WHERE contest_id = $1::uuid GROUP BY option_ref
		ORDER BY SUM(quantity) DESC, option_ref LIMIT $2`, id, maxEntrants+1)
	if err != nil {
		return nil, fmt.Errorf("connect: contest tallies: %w", err)
	}
	defer trows.Close()
	for trows.Next() {
		var ref string
		var t tally
		if err := trows.Scan(&ref, &t.Paid, &t.Free, &t.Kobo); err != nil {
			return nil, err
		}
		tallies[ref] = t
	}
	if err := trows.Err(); err != nil {
		return nil, err
	}
	rrows, err := s.db.Query(ctx, `SELECT id::text, name FROM contestants WHERE connect_contest_id = $1::uuid ORDER BY id LIMIT $2`, id, maxEntrants+1)
	if err != nil {
		return nil, fmt.Errorf("connect: contest roster: %w", err)
	}
	defer rrows.Close()
	var roster []rosterEntry
	for rrows.Next() {
		var e rosterEntry
		if err := rrows.Scan(&e.ID, &e.Name); err != nil {
			return nil, err
		}
		roster = append(roster, e)
	}
	if err := rrows.Err(); err != nil {
		return nil, err
	}
	entrants := mergeEntrants(roster, tallies)
	truncated := len(entrants) > maxEntrants
	if truncated {
		entrants = entrants[:maxEntrants]
	}
	return &ContestDetail{ContestSummary: contestSummaryOf(r), Entrants: entrants, EntrantsTruncated: truncated, Flags: []interface{}{}}, nil
}

// Contests — GET /api/connect/admin/voting?status=&limit=   (RBAC connect.moderation.view; money needs connect.gifting.view)
func (h *Handler) Contests(c *gin.Context) {
	status, ok := parseContestStatus(c.Query("status"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, keyError: "invalid status"})
		return
	}
	list, more, err := h.svc.ListContests(c.Request.Context(), status, userLimit(c.Query("limit")))
	if err != nil {
		internalErr(c, "list contests", err)
		return
	}
	if !h.canSeeMoney(c) {
		for i := range list {
			list[i].PaidVoteVolumeKobo = nil
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "has_more": more})
}

// Contest — GET /api/connect/admin/voting/:id
func (h *Handler) Contest(c *gin.Context) {
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, keyError: "not_found"})
		return
	}
	d, err := h.svc.GetContest(c.Request.Context(), c.Param("id"))
	if errors.Is(err, ErrContestNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, keyError: "not_found"})
		return
	}
	if err != nil {
		internalErr(c, "get contest", err)
		return
	}
	if !h.canSeeMoney(c) {
		d.PaidVoteVolumeKobo = nil
		for i := range d.Entrants {
			d.Entrants[i].TallyKobo = nil
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}
