// Package connectconsole serves the read-only Connect admin console views that have no domain
// service of their own: the user directory, the operations dashboard and the finance summary.
// Every view is a projection of existing tables; fields the data model does not hold are null
// or omitted, never invented, and personal data is masked.
package connectconsole

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	connectverification "spotlight/backend/internal/connect/verification"
)

// ErrUserNotFound is returned for an id with no Connect profile.
var ErrUserNotFound = errors.New("connect: user not found")

// Service reads the console projections.
type Service struct{ db *pgxpool.Pool }

// NewService wraps a pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// UserSummary mirrors frontend-admin ConnectUserSummary.
type UserSummary struct {
	ID               string   `json:"id"`
	Handle           string   `json:"handle"`
	DisplayName      string   `json:"display_name"`
	Tier             int      `json:"tier"`
	Status           string   `json:"status"`
	Region           string   `json:"region"`
	Verification     string   `json:"verification"`
	Flags            []string `json:"flags"`
	WalletBalanceKob int64    `json:"wallet_balance_kobo"`
	CreatedAt        string   `json:"created_at"`
	LastActiveAt     string   `json:"last_active_at"`
}

// UserDetail mirrors frontend-admin ConnectUserDetail. Devices and tier history are not stored
// anywhere yet, so they are empty lists (never fabricated).
type UserDetail struct {
	UserSummary
	EmailMasked             string        `json:"email_masked"`
	PhoneMasked             string        `json:"phone_masked"`
	Modes                   []string      `json:"modes"`
	LifetimeGiftSentKobo    int64         `json:"lifetime_gift_sent_kobo"`
	LifetimeGiftReceivedKob int64         `json:"lifetime_gift_received_kobo"`
	BVNStatus               string        `json:"bvn_status"`
	NINStatus               string        `json:"nin_status"`
	Devices                 []interface{} `json:"devices"`
	TierHistory             []interface{} `json:"tier_history"`
	OpenCases               int           `json:"open_cases"`
}

type userRow struct {
	ID             string
	DisplayName    *string
	City           *string
	CreatedAt      time.Time
	Tier           int
	PlatformStatus *string
	LastLoginAt    *time.Time
	VerStatus      *string
	VerLevel       *string
	VerDocType     *string
	Restriction    *string
	WalletKobo     int64
	OpenCases      int
	UnderageQueued bool
	// detail only
	Email, Phone        *string
	HasBVN, HasNIN      bool
	Modes               []string
	GiftSent, GiftRecvd int64
}

func maskEmail(e string) string {
	at := strings.LastIndex(e, "@")
	if at < 1 || at == len(e)-1 {
		return ""
	}
	return string([]rune(e)[:1]) + "•••" + e[at:]
}

func maskPhone(p string) string {
	digits := make([]rune, 0, len(p))
	for _, r := range p {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) < 6 {
		return ""
	}
	return "••••" + string(digits[len(digits)-3:])
}

// userStatus resolves the console status: a ban beats a suspension beats a login lockout beats
// pending. platform_users.status is the account state; connect_account_restrictions is Connect-specific.
func userStatus(restriction, platform string) string {
	switch {
	case restriction == "banned":
		return "banned"
	case restriction == "suspended", platform == "suspended":
		return "suspended"
	case platform == "locked":
		return "restricted"
	case platform == "pending":
		return "pending"
	}
	return "active"
}

func idStatus(present bool) string {
	if present {
		return "verified"
	}
	return "none"
}

var userStatuses = map[string]bool{"all": true, "active": true, "suspended": true, "banned": true, "restricted": true, "pending": true}

func parseUserStatus(s string) (string, bool) {
	if s == "" {
		return "all", true
	}
	if userStatuses[s] {
		return s, true
	}
	return "", false
}

func userLimit(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 100
	}
	if n > 200 {
		return 200
	}
	return n
}

// searchPattern turns a search term into a safe ILIKE pattern ("" = no filter): wildcards in the
// term are escaped and the term is capped.
func searchPattern(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if r := []rune(s); len(r) > 64 {
		s = string(r[:64])
	}
	s = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
	return "%" + s + "%"
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func summaryOf(r userRow) UserSummary {
	name := strings.TrimSpace(str(r.DisplayName))
	handle := name
	if handle == "" {
		handle = "user " + r.ID
	}
	last := r.CreatedAt
	if r.LastLoginAt != nil {
		last = *r.LastLoginAt
	}
	flags := []string{}
	if r.OpenCases > 0 {
		flags = append(flags, "open_case")
	}
	if r.UnderageQueued {
		flags = append(flags, "underage_review")
	}
	if r.Restriction != nil && *r.Restriction != "" {
		flags = append(flags, "restricted_"+*r.Restriction)
	}
	return UserSummary{
		ID: r.ID, Handle: handle, DisplayName: name, Tier: r.Tier,
		Status:       userStatus(str(r.Restriction), str(r.PlatformStatus)),
		Region:       str(r.City),
		Verification: connectverification.BadgeFor(str(r.VerLevel), r.VerDocType, str(r.VerStatus)),
		Flags:        flags, WalletBalanceKob: r.WalletKobo,
		CreatedAt:    r.CreatedAt.UTC().Format(time.RFC3339),
		LastActiveAt: last.UTC().Format(time.RFC3339),
	}
}

func detailOf(r userRow) UserDetail {
	modes := r.Modes
	if modes == nil {
		modes = []string{}
	}
	return UserDetail{
		UserSummary: summaryOf(r), EmailMasked: maskEmail(str(r.Email)), PhoneMasked: maskPhone(str(r.Phone)),
		Modes: modes, LifetimeGiftSentKobo: r.GiftSent, LifetimeGiftReceivedKob: r.GiftRecvd,
		BVNStatus: idStatus(r.HasBVN), NINStatus: idStatus(r.HasNIN),
		Devices: []interface{}{}, TierHistory: []interface{}{}, OpenCases: r.OpenCases,
	}
}

// userSelect is shared by the list and the detail. The platform status 'deleted' is excluded.
const userSelect = `SELECT p.user_id::text, p.display_name, p.city, p.created_at,
	COALESCE(up.kyc_tier, 0)::int, pu.status, pu.last_login_at,
	v.status, v.level, v.doc_type,
	(SELECT r.type FROM connect_account_restrictions r
	  WHERE r.user_id = p.user_id AND r.active AND (r.expires_at IS NULL OR r.expires_at > now())
	  ORDER BY (r.type = 'banned') DESC, r.created_at DESC LIMIT 1),
	COALESCE((SELECT SUM(w.available_kobo) FROM wallet_balance w WHERE w.user_id = p.user_id AND w.account_type = 'user_wallet'), 0)::bigint,
	(SELECT count(*) FROM connect_cases c WHERE c.subject_id = p.user_id AND c.status IN ('open','investigating'))::int,
	EXISTS (SELECT 1 FROM connect_underage_flags f WHERE f.user_id = p.user_id AND f.status = 'queued'),
	pu.email, pu.phone, (up.bvn_hash IS NOT NULL), (up.nin_hash IS NOT NULL),
	COALESCE((SELECT array_agg(m.mode ORDER BY m.mode) FROM connect_profile_modes m WHERE m.profile_id = p.id AND m.visible), ARRAY[]::text[]),
	COALESCE((SELECT SUM(g.amount_kobo) FROM connect_gifts g WHERE g.sender_id = p.user_id AND g.status = 'sent'), 0)::bigint,
	COALESCE((SELECT SUM(g.amount_kobo) FROM connect_gifts g WHERE g.recipient_id = p.user_id AND g.status = 'sent'), 0)::bigint
	FROM connect_profiles p
	LEFT JOIN user_profiles up ON up.id = p.user_id
	LEFT JOIN platform_users pu ON pu.id = p.user_id
	LEFT JOIN connect_verification v ON v.user_id = p.user_id
	WHERE p.deleted_at IS NULL AND pu.status IS DISTINCT FROM 'deleted'`

func scanUser(row pgx.Row) (userRow, error) {
	var r userRow
	err := row.Scan(&r.ID, &r.DisplayName, &r.City, &r.CreatedAt, &r.Tier, &r.PlatformStatus, &r.LastLoginAt,
		&r.VerStatus, &r.VerLevel, &r.VerDocType, &r.Restriction, &r.WalletKobo, &r.OpenCases, &r.UnderageQueued,
		&r.Email, &r.Phone, &r.HasBVN, &r.HasNIN, &r.Modes, &r.GiftSent, &r.GiftRecvd)
	return r, err
}

// ListUsers returns a page of users (newest first), filtered by search and status, plus has_more.
// The status filter is applied after the derived status is computed, in Go, over an over-fetch bounded
// by the SQL limit, so it stays correct for the ban/suspension precedence.
func (s *Service) ListUsers(ctx context.Context, search, status string, limit int) ([]UserSummary, bool, error) {
	fetch := limit + 1
	if status != "all" {
		fetch = 1000 // status is derived from several tables; scan a bounded window then filter
	}
	rows, err := s.db.Query(ctx, userSelect+`
		AND ($1 = '' OR p.display_name ILIKE $1 ESCAPE '\')
		ORDER BY p.created_at DESC LIMIT $2`, search, fetch)
	if err != nil {
		return nil, false, fmt.Errorf("connect: list users: %w", err)
	}
	defer rows.Close()
	out := make([]UserSummary, 0, limit)
	more := false
	for rows.Next() {
		r, err := scanUser(rows)
		if err != nil {
			return nil, false, err
		}
		u := summaryOf(r)
		if status != "all" && u.Status != status {
			continue
		}
		if len(out) == limit {
			more = true
			break
		}
		out = append(out, u)
	}
	return out, more, rows.Err()
}

// GetUser returns one user's detail, or ErrUserNotFound.
func (s *Service) GetUser(ctx context.Context, id string) (*UserDetail, error) {
	r, err := scanUser(s.db.QueryRow(ctx, userSelect+` AND p.user_id = $1::uuid LIMIT 1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get user: %w", err)
	}
	d := detailOf(r)
	return &d, nil
}
