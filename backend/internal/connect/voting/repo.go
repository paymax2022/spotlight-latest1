package connectvoting

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles connect_contests + connect_votes reads/writes over a pgx
// pool. Vote inserts are append-only (immutable tally records). All queries are
// parameterized.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds a voting repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const contestColumns = `id, title, description, status, paid_vote_kobo,
	free_votes_per_user, velocity_per_minute, opens_at, closes_at, created_at, rules_text, banner_image_url`

// ListContests returns open/closed contests, newest first.
func (r *Repository) ListContests(ctx context.Context, limit int) ([]Contest, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT ` + contestColumns + `,
			(SELECT COUNT(*) FROM contestants ct
			  WHERE ct.connect_contest_id = connect_contests.id AND ct.is_active) AS contestant_count,
			(SELECT COALESCE(SUM(quantity), 0) FROM connect_votes cv
			  WHERE cv.contest_id = connect_contests.id) AS total_votes
		FROM connect_contests
		WHERE status IN ('open','closed') ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("voting: list contests: %w", err)
	}
	defer rows.Close()
	out := []Contest{}
	for rows.Next() {
		c, err := scanContestWithCounts(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetContest fetches a single contest by id.
func (r *Repository) GetContest(ctx context.Context, id string) (*Contest, error) {
	const q = `SELECT ` + contestColumns + ` FROM connect_contests WHERE id = $1`
	return scanContest(r.db.QueryRow(ctx, q, id))
}

// rowScanner abstracts pgx.Row / pgx.Rows for the shared contest scan.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanContest(s rowScanner) (*Contest, error) {
	c := &Contest{}
	if err := s.Scan(
		&c.ID, &c.Title, &c.Description, &c.Status, &c.PaidVoteKobo,
		&c.FreeVotesPerUser, &c.VelocityPerMinute, &c.OpensAt, &c.ClosesAt, &c.CreatedAt,
		&c.RulesText, &c.BannerImageURL,
	); err != nil {
		return nil, err
	}
	return c, nil
}

// scanContestWithCounts scans a contest row that carries the roster/tally
// summary columns appended by ListContests.
func scanContestWithCounts(s rowScanner) (*Contest, error) {
	c := &Contest{}
	if err := s.Scan(
		&c.ID, &c.Title, &c.Description, &c.Status, &c.PaidVoteKobo,
		&c.FreeVotesPerUser, &c.VelocityPerMinute, &c.OpensAt, &c.ClosesAt, &c.CreatedAt,
		&c.RulesText, &c.BannerImageURL, &c.ContestantCount, &c.TotalVotes,
	); err != nil {
		return nil, err
	}
	return c, nil
}

// CountFreeVotes returns how many free votes the user has cast in a contest.
func (r *Repository) CountFreeVotes(ctx context.Context, contestID, voterID string) (int, error) {
	const q = `SELECT COUNT(*) FROM connect_votes
		WHERE contest_id = $1 AND voter_id = $2 AND paid = false`
	var n int
	err := r.db.QueryRow(ctx, q, contestID, voterID).Scan(&n)
	return n, err
}

// CountRecentVotes returns how many votes (any kind) the user cast in a contest
// since `since` — used for the per-window velocity guard.
func (r *Repository) CountRecentVotes(ctx context.Context, contestID, voterID string, since time.Time) (int, error) {
	const q = `SELECT COUNT(*) FROM connect_votes
		WHERE contest_id = $1 AND voter_id = $2 AND created_at >= $3`
	var n int
	err := r.db.QueryRow(ctx, q, contestID, voterID, since).Scan(&n)
	return n, err
}

// InsertVote records an immutable vote row (free or paid).
func (r *Repository) InsertVote(ctx context.Context, v *Vote) (*Vote, error) {
	const ins = `INSERT INTO connect_votes
		(contest_id, voter_id, option_ref, paid, quantity, amount_kobo, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, contest_id, voter_id, option_ref, paid, quantity, amount_kobo, ledger_ref, created_at`
	out := &Vote{}
	if err := r.db.QueryRow(ctx, ins,
		v.ContestID, v.VoterID, v.OptionRef, v.Paid, v.Quantity, v.AmountKobo, v.IdempotencyKey, v.LedgerRef,
	).Scan(
		&out.ID, &out.ContestID, &out.VoterID, &out.OptionRef, &out.Paid,
		&out.Quantity, &out.AmountKobo, &out.LedgerRef, &out.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("voting: insert vote: %w", err)
	}
	return out, nil
}

// Results tallies free vs paid vote units per option for a contest.
func (r *Repository) Results(ctx context.Context, contestID string) ([]ResultRow, error) {
	const q = `SELECT option_ref,
			COALESCE(SUM(CASE WHEN paid = false THEN quantity ELSE 0 END), 0) AS free_votes,
			COALESCE(SUM(CASE WHEN paid = true  THEN quantity ELSE 0 END), 0) AS paid_votes
		FROM connect_votes
		WHERE contest_id = $1
		GROUP BY option_ref
		ORDER BY (COALESCE(SUM(quantity),0)) DESC`
	rows, err := r.db.Query(ctx, q, contestID)
	if err != nil {
		return nil, fmt.Errorf("voting: results: %w", err)
	}
	defer rows.Close()
	var out []ResultRow
	for rows.Next() {
		var rr ResultRow
		if err := rows.Scan(&rr.OptionRef, &rr.FreeVotes, &rr.PaidVotes); err != nil {
			return nil, err
		}
		rr.TotalVotes = rr.FreeVotes + rr.PaidVotes
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ContestStage represents a single contest stage with eviction config.
type ContestStage struct {
	ID                    string     `json:"id"`
	ContestID             string     `json:"contest_id"`
	StageNumber           int        `json:"stage_number"`
	StageName             string     `json:"stage_name"`
	StageDescription      *string    `json:"stage_description,omitempty"`
	EvictionPercentage    int        `json:"eviction_percentage"`
	MinContestantsToEvict int        `json:"min_contestants_to_evict"`
	VotingStartsAt        *time.Time `json:"voting_starts_at,omitempty"`
	VotingEndsAt          *time.Time `json:"voting_ends_at,omitempty"`
	IsActive              bool       `json:"is_active"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

// GetStages retrieves all stages for a contest, ordered by stage number.
func (r *Repository) GetStages(ctx context.Context, contestID string) ([]ContestStage, error) {
	const q = `SELECT id, contest_id, stage_number, stage_name, stage_description,
		eviction_percentage, min_contestants_to_evict, voting_starts_at, voting_ends_at,
		is_active, created_at, updated_at
	FROM public.contest_stages
	WHERE contest_id = $1
	ORDER BY stage_number ASC`
	rows, err := r.db.Query(ctx, q, contestID)
	if err != nil {
		return nil, fmt.Errorf("get stages: %w", err)
	}
	defer rows.Close()

	var stages []ContestStage
	for rows.Next() {
		var stage ContestStage
		if err := rows.Scan(
			&stage.ID, &stage.ContestID, &stage.StageNumber, &stage.StageName,
			&stage.StageDescription, &stage.EvictionPercentage, &stage.MinContestantsToEvict,
			&stage.VotingStartsAt, &stage.VotingEndsAt, &stage.IsActive,
			&stage.CreatedAt, &stage.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan stage: %w", err)
		}
		stages = append(stages, stage)
	}
	return stages, rows.Err()
}

// RosterEntry is one contestant on a contest's voting roster, with the live
// tally for that contestant. Votes reference a contestant by its id in
// connect_votes.option_ref, which is what lets the roster and the tally join
// without a schema change to the immutable vote log.
type RosterEntry struct {
	ContestantID string `json:"contestant_id"`
	Name         string `json:"name"`
	StageName    string `json:"stage_name"`
	Category     string `json:"category"`
	State        string `json:"state"`
	Bio          string `json:"bio"`
	PhotoURL     string `json:"photo_url"`
	MediaURL     string `json:"media_url"`
	Status       string `json:"status"`
	IsActive     bool   `json:"is_active"`
	ContestID    string `json:"contest_id,omitempty"`
	FreeVotes    int64  `json:"free_votes"`
	PaidVotes    int64  `json:"paid_votes"`
	TotalVotes   int64  `json:"total_votes"`
	Rank         int    `json:"rank"`
}

// ListRoster returns the active contestants for a contest ordered by total
// votes, highest first. Only contestants promoted from an approved registration
// (or otherwise linked to this contest) appear.
//
// includeInactive surfaces evicted/rejected contestants too, which the admin
// views need; the member-facing list passes false.
func (r *Repository) ListRoster(ctx context.Context, contestID string, includeInactive bool) ([]RosterEntry, error) {
	const q = `
		SELECT c.id::text, c.name, c.stage_name, c.category, c.state, c.bio,
		       c.photo_url, c.media_url, c.status::text, c.is_active,
		       COALESCE(v.free_votes, 0), COALESCE(v.paid_votes, 0)
		FROM contestants c
		LEFT JOIN (
			SELECT option_ref,
			       SUM(CASE WHEN paid = false THEN quantity ELSE 0 END) AS free_votes,
			       SUM(CASE WHEN paid = true  THEN quantity ELSE 0 END) AS paid_votes
			FROM connect_votes
			WHERE contest_id = $1
			GROUP BY option_ref
		) v ON v.option_ref = c.id::text
		WHERE c.connect_contest_id = $1
		  AND ($2 OR c.is_active = true)
		ORDER BY (COALESCE(v.free_votes, 0) + COALESCE(v.paid_votes, 0)) DESC, c.name ASC`

	rows, err := r.db.Query(ctx, q, contestID, includeInactive)
	if err != nil {
		return nil, fmt.Errorf("voting: list roster: %w", err)
	}
	defer rows.Close()

	out := []RosterEntry{}
	for rows.Next() {
		var e RosterEntry
		if err := rows.Scan(&e.ContestantID, &e.Name, &e.StageName, &e.Category, &e.State,
			&e.Bio, &e.PhotoURL, &e.MediaURL,
			&e.Status, &e.IsActive, &e.FreeVotes, &e.PaidVotes); err != nil {
			return nil, fmt.Errorf("voting: scan roster entry: %w", err)
		}
		e.TotalVotes = e.FreeVotes + e.PaidVotes
		e.Rank = len(out) + 1
		out = append(out, e)
	}
	return out, rows.Err()
}

// IsOnRoster reports whether optionRef identifies an active contestant of the
// contest. Votes must land on a real, active contestant — without this an
// arbitrary option_ref string creates a phantom tally row that no roster entry
// can ever account for.
func (r *Repository) IsOnRoster(ctx context.Context, contestID, optionRef string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM contestants
			WHERE connect_contest_id = $1 AND id::text = $2 AND is_active = true
		)`, contestID, optionRef).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("voting: check roster membership: %w", err)
	}
	return ok, nil
}

// GetRosterEntry returns one contestant by id, with its live tally. Keyed on the
// contestant id alone (a UUID primary key), so the caller does not need to know
// which contest it belongs to.
//
// Returns (nil, nil) when no such contestant exists.
func (r *Repository) GetRosterEntry(ctx context.Context, contestantID string) (*RosterEntry, error) {
	const q = `
		SELECT c.id::text, c.name, c.stage_name, c.category, c.state, c.bio,
		       c.photo_url, c.media_url, c.status::text, c.is_active,
		       COALESCE(v.free_votes, 0), COALESCE(v.paid_votes, 0),
		       COALESCE(c.connect_contest_id::text, '')
		FROM contestants c
		LEFT JOIN (
			SELECT option_ref,
			       SUM(CASE WHEN paid = false THEN quantity ELSE 0 END) AS free_votes,
			       SUM(CASE WHEN paid = true  THEN quantity ELSE 0 END) AS paid_votes
			FROM connect_votes
			GROUP BY option_ref
		) v ON v.option_ref = c.id::text
		WHERE c.id::text = $1`

	var e RosterEntry
	var contestID string
	err := r.db.QueryRow(ctx, q, contestantID).Scan(
		&e.ContestantID, &e.Name, &e.StageName, &e.Category, &e.State, &e.Bio,
		&e.PhotoURL, &e.MediaURL, &e.Status, &e.IsActive,
		&e.FreeVotes, &e.PaidVotes, &contestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("voting: get roster entry: %w", err)
	}
	e.TotalVotes = e.FreeVotes + e.PaidVotes
	e.ContestID = contestID

	// Rank is a property of the whole roster, so derive it from the contestant's
	// own contest rather than reporting a meaningless 0.
	if contestID != "" {
		if err := r.db.QueryRow(ctx, `
			SELECT COUNT(*) + 1
			FROM contestants c2
			LEFT JOIN (
				SELECT option_ref, SUM(quantity) AS total
				FROM connect_votes WHERE contest_id = $1 GROUP BY option_ref
			) v2 ON v2.option_ref = c2.id::text
			WHERE c2.connect_contest_id = $1 AND c2.is_active
			  AND COALESCE(v2.total, 0) > $2`, contestID, e.TotalVotes).Scan(&e.Rank); err != nil {
			return nil, fmt.Errorf("voting: rank roster entry: %w", err)
		}
	}
	return &e, nil
}

// ─── My votes / contestant supporters ────────────────────────────────────────

// MyVote is one vote the caller cast, resolved to the contest and contestant it
// was for. connect_votes stores option_ref as the contestant id, so the name and
// photo come from a join rather than being duplicated onto the immutable log.
type MyVote struct {
	ID             string    `json:"id"`
	ContestID      string    `json:"contest_id"`
	ContestTitle   string    `json:"contest_title"`
	ContestantID   string    `json:"contestant_id"`
	ContestantName string    `json:"contestant_name"`
	PhotoURL       string    `json:"photo_url"`
	Paid           bool      `json:"paid"`
	Quantity       int       `json:"quantity"`
	AmountKobo     int64     `json:"amount_kobo"`
	CreatedAt      time.Time `json:"created_at"`
}

// MyVotes returns the caller's own votes, newest first.
//
// Scoped on voter_id and nothing else: this is the one read where a user is
// entitled to the identities involved, because every row is their own action.
// The (contest_id, voter_id, created_at DESC) index does not cover a voter-only
// scan, so the contest filter is worth passing when the caller has one.
func (r *Repository) MyVotes(ctx context.Context, voterID, contestID string, paidOnly, freeOnly bool) ([]MyVote, error) {
	q := `
		SELECT v.id::text, v.contest_id::text, COALESCE(ct.title, ''),
		       v.option_ref, COALESCE(NULLIF(c.name, ''), NULLIF(c.stage_name, ''), 'Contestant'),
		       COALESCE(c.photo_url, ''),
		       v.paid, v.quantity, v.amount_kobo, v.created_at
		FROM connect_votes v
		LEFT JOIN connect_contests ct ON ct.id = v.contest_id
		LEFT JOIN contestants c ON c.id::text = v.option_ref
		WHERE v.voter_id = $1`
	args := []any{voterID}
	if contestID != "" {
		args = append(args, contestID)
		q += fmt.Sprintf(" AND v.contest_id = $%d", len(args))
	}
	// paidOnly and freeOnly are mutually exclusive by construction in the
	// handler; both false means no filter.
	if paidOnly {
		q += " AND v.paid = true"
	} else if freeOnly {
		q += " AND v.paid = false"
	}
	q += " ORDER BY v.created_at DESC LIMIT 200"

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("voting: my votes: %w", err)
	}
	defer rows.Close()

	out := []MyVote{}
	for rows.Next() {
		var m MyVote
		if err := rows.Scan(&m.ID, &m.ContestID, &m.ContestTitle, &m.ContestantID,
			&m.ContestantName, &m.PhotoURL, &m.Paid, &m.Quantity, &m.AmountKobo, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("voting: scan my vote: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Supporter is one person who voted for a contestant.
type Supporter struct {
	VoterName  string    `json:"voter_name"`
	Anonymous  bool      `json:"anonymous"`
	Paid       bool      `json:"paid"`
	Quantity   int       `json:"quantity"`
	AmountKobo int64     `json:"amount_kobo"`
	CreatedAt  time.Time `json:"created_at"`
}

// ContestantOwner returns the user id that owns a contestant, and the contest it
// belongs to. Used to decide whether the caller may see that contestant's
// supporters — the answer is "only if it is them".
func (r *Repository) ContestantOwner(ctx context.Context, contestantID string) (userID, contestID string, err error) {
	var uid, cid *string
	if err := r.db.QueryRow(ctx,
		`SELECT user_id::text, connect_contest_id::text FROM contestants WHERE id::text = $1`,
		contestantID).Scan(&uid, &cid); err != nil {
		return "", "", err
	}
	if uid != nil {
		userID = *uid
	}
	if cid != nil {
		contestID = *cid
	}
	return userID, contestID, nil
}

// Supporters lists who voted for one contestant, newest first.
//
// ANONYMITY IS RESOLVED HERE, NOT IN THE CLIENT. When the contest sets
// allow_anonymous_free_vote, a FREE vote was cast under a promise of anonymity
// and its voter must never be named — so the name is dropped at the query and
// the row comes back flagged instead. Returning the id and letting the client
// decide would ship the identity to a device and rely on it to look away.
//
// Paid votes are always attributed: they are a transaction with a receipt, and
// the anonymity setting covers free voting only.
func (r *Repository) Supporters(ctx context.Context, contestantID, contestID string) ([]Supporter, error) {
	const q = `
		WITH anon AS (
			-- "on" is a reserved word: aliasing to it parses inside the CTE and
			-- then fails at the first reference. Named explicitly instead.
			SELECT COALESCE(BOOL_OR(allow_anonymous_free_vote), false) AS anon_enabled
			FROM voting_settings WHERE contest_id = $2
		)
		SELECT
			CASE WHEN (SELECT anon_enabled FROM anon) AND v.paid = false THEN ''
			     ELSE COALESCE(NULLIF(u.raw_user_meta_data->>'full_name', ''), u.email, 'A voter')
			END,
			((SELECT anon_enabled FROM anon) AND v.paid = false),
			v.paid, v.quantity, v.amount_kobo, v.created_at
		FROM connect_votes v
		LEFT JOIN auth.users u ON u.id = v.voter_id
		WHERE v.option_ref = $1 AND v.contest_id = $2
		ORDER BY v.created_at DESC
		LIMIT 500`
	rows, err := r.db.Query(ctx, q, contestantID, contestID)
	if err != nil {
		return nil, fmt.Errorf("voting: supporters: %w", err)
	}
	defer rows.Close()

	out := []Supporter{}
	for rows.Next() {
		var s Supporter
		if err := rows.Scan(&s.VoterName, &s.Anonymous, &s.Paid, &s.Quantity, &s.AmountKobo, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("voting: scan supporter: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// MyVote returns one of the caller's own votes, or pgx.ErrNoRows.
//
// Scoped on voter_id as well as id: a vote id is a bare uuid, and a receipt is
// the voter's own record. Someone else's vote answers the same as a vote that
// does not exist, so the endpoint never confirms an id it will not serve.
func (r *Repository) MyVote(ctx context.Context, voterID, voteID string) (*MyVote, error) {
	const q = `
		SELECT v.id::text, v.contest_id::text, COALESCE(ct.title, ''),
		       v.option_ref, COALESCE(NULLIF(c.name, ''), NULLIF(c.stage_name, ''), 'Contestant'),
		       COALESCE(c.photo_url, ''),
		       v.paid, v.quantity, v.amount_kobo, v.created_at
		FROM connect_votes v
		LEFT JOIN connect_contests ct ON ct.id = v.contest_id
		LEFT JOIN contestants c ON c.id::text = v.option_ref
		WHERE v.id::text = $1 AND v.voter_id = $2`
	var m MyVote
	if err := r.db.QueryRow(ctx, q, voteID, voterID).Scan(&m.ID, &m.ContestID, &m.ContestTitle,
		&m.ContestantID, &m.ContestantName, &m.PhotoURL, &m.Paid, &m.Quantity,
		&m.AmountKobo, &m.CreatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

// Notification is one entry in the voting activity feed.
type Notification struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"`
	Title        string    `json:"title"`
	Message      string    `json:"message"`
	ContestID    string    `json:"contest_id,omitempty"`
	ContestantID string    `json:"contestant_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	Read         bool      `json:"read"`
}

// Notifications derives the caller's voting activity feed.
//
// THERE IS NO NOTIFICATIONS STORE. Nothing in this module has ever written a
// voting notification anywhere, so this feed is COMPUTED from the two things the
// database actually records: the caller's votes, and the deadline of contests
// they voted in.
//
// The client's VotingNotification union names seven kinds. Two are derivable and
// are produced here. The other five are not, and it is worth being exact about
// why, because "not implemented" and "impossible from this data" are different
// problems:
//
//	VOTE_SUCCESS      ✔ every row of connect_votes is a vote that succeeded
//	CONTEST_ENDING    ✔ connect_contests.closes_at
//	PAYMENT_FAILED    ✘ connect_votes records successes only; a failed payment
//	                    leaves no row, so there is nothing to report
//	RANK_CHANGED      ✘ needs a history of past standings; only the current
//	                    tally is stored
//	RESULTS_PUBLISHED ✘ no publication event is recorded
//	FREE_VOTES_RESET  ✘ the reset is a time-of-day rule, not an event
//	VOTING_LIVE       ✘ would need a follow/subscribe relationship to know
//	                    which contests a user wants to hear about
//
// Emitting those five needs an events table written at the moment each happens,
// which is a different change from this one.
//
// `read` is always true. Read state is per-user, per-notification durable state,
// and a derived feed has nowhere to keep it — returning false would give every
// row a permanent unread dot that no amount of reading could clear.
func (r *Repository) Notifications(ctx context.Context, userID string) ([]Notification, error) {
	const q = `
		-- Each of the caller's votes, as a "your vote counted" entry.
		SELECT 'vote:' || v.id::text,
		       'VOTE_SUCCESS',
		       'Vote confirmed',
		       'Your ' || v.quantity || CASE WHEN v.quantity = 1 THEN ' vote for ' ELSE ' votes for ' END
		         || COALESCE(NULLIF(c.name, ''), 'a contestant')
		         || COALESCE(' in ' || NULLIF(ct.title, ''), '') || ' was counted.',
		       v.contest_id::text,
		       v.option_ref,
		       v.created_at
		FROM connect_votes v
		LEFT JOIN contestants c ON c.id::text = v.option_ref
		LEFT JOIN connect_contests ct ON ct.id = v.contest_id
		WHERE v.voter_id = $1

		UNION ALL

		-- Contests the caller has voted in that are closing soon and still open.
		-- DISTINCT because they may have voted many times in the same contest,
		-- and one deadline is one notification.
		SELECT DISTINCT ON (ct.id)
		       'closing:' || ct.id::text,
		       'CONTEST_ENDING',
		       'Voting closes soon',
		       COALESCE(NULLIF(ct.title, ''), 'A contest') || ' closes on '
		         || to_char(ct.closes_at, 'DD Mon'),
		       ct.id::text,
		       '',
		       ct.closes_at
		FROM connect_contests ct
		WHERE ct.closes_at IS NOT NULL
		  AND ct.closes_at > now()
		  AND ct.closes_at < now() + interval '7 days'
		  AND EXISTS (SELECT 1 FROM connect_votes v2
		              WHERE v2.contest_id = ct.id AND v2.voter_id = $1)

		ORDER BY 7 DESC
		LIMIT 50`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("voting: notifications: %w", err)
	}
	defer rows.Close()

	out := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Message,
			&n.ContestID, &n.ContestantID, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("voting: scan notification: %w", err)
		}
		n.Read = true
		out = append(out, n)
	}
	return out, rows.Err()
}
