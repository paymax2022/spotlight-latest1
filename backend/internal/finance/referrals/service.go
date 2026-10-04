package referrals

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
)

const (
	keyError           = "error"
	keyReferrerID      = "referrer_id"
	keyReferredUserID  = "referred_user_id"
	msgUnauthenticated = "unauthenticated"
)

// Service manages referral codes and reward processing.
type Service struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
}

// GetOrCreateCode returns the user's referral code, creating one if needed.
func (s *Service) GetOrCreateCode(ctx context.Context, userID string) (*Code, error) {
	const q = `SELECT code, created_at FROM finance_referral_codes WHERE user_id = $1`
	var c Code
	c.UserID = userID
	err := s.db.QueryRow(ctx, q, userID).Scan(&c.Code, &c.CreatedAt)
	if err == nil {
		return &c, nil
	}
	// GenerateCode() is the shared generator referral_links also uses (REF-004):
	// one alphabet, one length, one case, regardless of which stack issues the
	// code — every writer produces the frontend's SPOT-XXXXXX shape.
	code, err := GenerateCode()
	if err != nil {
		return nil, fmt.Errorf("referrals: generate code: %w", err)
	}
	const insert = `
		INSERT INTO finance_referral_codes (user_id, code)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO NOTHING
		RETURNING code, created_at`
	if err := s.db.QueryRow(ctx, insert, userID, code).Scan(&c.Code, &c.CreatedAt); err != nil {
		// Race — fetch.
		return s.GetOrCreateCode(ctx, userID)
	}
	return &c, nil
}

// GetSummary returns the referral summary for a user.
func (s *Service) GetSummary(ctx context.Context, userID string) (*Summary, error) {
	code, err := s.GetOrCreateCode(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `
		SELECT COUNT(*), COALESCE(SUM(amount_kobo), 0)
		FROM referral_events
		WHERE referrer_id = $1`
	var count int
	var earned int64
	if err := s.db.QueryRow(ctx, q, userID).Scan(&count, &earned); err != nil {
		return nil, fmt.Errorf("referrals: get summary: %w", err)
	}
	return &Summary{
		Code:            code.Code,
		TotalReferrals:  count,
		TotalEarnedKobo: earned,
	}, nil
}

// ResolveCodeToReferrer returns the user ID that owns a referral code.
// REF-008: the comparison is case-INSENSITIVE. Codes generated before this fix
// may be stored in any case (the old generator here emitted lowercase hex; the
// frontend generator emitted uppercase), and normalizeCode() in
// internal/referral/attribution upper-cases whatever the caller typed before
// resolving — a case-sensitive comparison would make every lowercase legacy
// code permanently unresolvable. Matching on UPPER(code) keeps every
// already-issued code (whatever case it happens to be stored in) resolvable,
// while new codes (see GenerateCode) are uppercase-only going forward.
func (s *Service) ResolveCodeToReferrer(ctx context.Context, code string) (string, error) {
	const q = `SELECT user_id FROM finance_referral_codes WHERE UPPER(code) = UPPER($1)`
	normalized := NormalizeCode(code)
	var referrerID string
	if err := s.db.QueryRow(ctx, q, normalized).Scan(&referrerID); err != nil {
		return "", fmt.Errorf("referrals: resolve code %q: %w", code, err)
	}
	return referrerID, nil
}

// ProcessReward credits the referrer and records the event.
// Idempotent: UNIQUE(referrer_id, referred_id) prevents double-reward.
func (s *Service) ProcessReward(ctx context.Context, referrerID, referredID string) error {
	if referrerID == referredID {
		return fmt.Errorf("referrals: self-referral blocked")
	}

	idempotencyKey := fmt.Sprintf("referral:reward:%s:%s", referrerID, referredID)

	var existing string
	const checkDup = `SELECT id FROM referral_events WHERE referrer_id=$1 AND referred_id=$2 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, referrerID, referredID).Scan(&existing)
	if existing != "" {
		return nil // already processed
	}

	rewardAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
	if err != nil {
		return err
	}
	if err := s.ledger.Credit(ctx, referrerID, "referral:reward:"+referredID, idempotencyKey, rewardAcc.ID, RewardAmountKobo); err != nil {
		if err == ledger.ErrDuplicate {
			return nil
		}
		return fmt.Errorf("referrals: credit reward: %w", err)
	}

	const insert = `
		INSERT INTO referral_events (referrer_id, referred_id, amount_kobo)
		VALUES ($1, $2, $3)
		ON CONFLICT (referrer_id, referred_id) DO NOTHING`
	_, err = s.db.Exec(ctx, insert, referrerID, referredID, RewardAmountKobo)
	return err
}

const (
	RewardAmountKobo = 50_000 // ₦500 per referral
)

// Code is a user's referral code.
type Code struct {
	UserID    string    `json:"user_id"`
	Code      string    `json:"code"`
	CreatedAt time.Time `json:"created_at"`
}

// Event records when a referral reward was earned.
type Event struct {
	ID         string    `json:"id"`
	ReferrerID string    `json:"referrer_id"`
	ReferredID string    `json:"referred_id"`
	AmountKobo int64     `json:"amount_kobo"`
	CreatedAt  time.Time `json:"created_at"`
}

// Summary is the response for GET /finance/referrals/me.
type Summary struct {
	Code            string `json:"code"`
	TotalReferrals  int    `json:"total_referrals"`
	TotalEarnedKobo int64  `json:"total_earned_kobo"`
}

// Handler exposes referral endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetMe handles GET /finance/referrals/me
func (h *Handler) GetMe(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	summary, err := h.svc.GetSummary(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, summary)
}

// Referral code shape — generation, normalisation and validation.
// A referral code is READ ALOUD and TYPED IN by hand ("use my code 7KQ4M"), so
// length and legibility are the whole design. The engine used to issue
// "R" + hex(5 bytes) = 11 characters, which is unusable in that setting.
// Codes are now 5 characters from a 27-symbol alphabet: A-Z and 0-9 minus every
// character in a confusable pair — the letters O, I, L, S, Z and the digits 0,
// 1, 5, 2. BOTH halves of each pair go: keeping the digit and dropping only the
// letter still leaves a caller unsure which they heard. That is 27^5 ≈ 14.3
// million codes. Short codes collide far more readily than 11-character ones
// did, so every issuing path must retry on the unique index rather than assume
// success.

const (
	// CodeMaxLen is the ceiling for BOTH generated and admin-chosen codes.
	CodeMaxLen = 5
	// CodeMinLen keeps a custom code from being trivially guessable or blank.
	CodeMinLen = 3

	// codeAlphabet is used for GENERATED codes only. It omits every character in
	// a confusable pair — the letters O, I, L, S, Z and the digits 0, 1, 5, 2 —
	// because a random string has no meaning to anchor a misread character
	// against. 27 symbols; 27^5 ~= 14.3 million codes.
	codeAlphabet = "ABCDEFGHJKMNPQRTUVWXY346789"

	// codeAllowed is the WIDER set accepted for an ADMIN-CHOSEN code.
	// The two differ deliberately. Applying the generator's alphabet to custom
	// codes would have made the feature almost useless: O, I, L, S and Z are
	// among the commonest letters, so SALES, GOLD, LAGOS and most human names
	// would be rejected. A chosen code is memorable, and that memorability is
	// what protects it from being misread — the property the restricted alphabet
	// exists to supply for random strings. An admin picking O0 confusion is
	// making an informed trade the generator cannot.
	codeAllowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

// GenerateCode returns a random code of CodeMaxLen characters.
// It uses crypto/rand with rejection-free modular selection via rand.Int, so the
// distribution is uniform over the alphabet — a modulo of raw bytes would bias
// toward the first 256%31 symbols, which for a guessable identifier is a real
// (if small) weakness.
func GenerateCode() (string, error) {
	var b strings.Builder
	b.Grow(CodeMaxLen)
	max := big.NewInt(int64(len(codeAlphabet)))
	for range CodeMaxLen {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("referrals: generate code: %w", err)
		}
		b.WriteByte(codeAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// NormalizeCode is the single definition of "the same code".
// It must be applied on EVERY path that stores or looks up a code, or the
// uniqueness check becomes a lie: "7kq4m" would pass a duplicate check against a
// stored "7KQ4M" and then resolve to whichever row a lookup happened to find.
func NormalizeCode(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

// ValidateCode checks an admin-supplied code's shape: 3-5 characters of A-Z0-9,
// already normalised. It accepts the FULL alphanumeric set, not the narrower one
// the generator draws from — see codeAllowed for why.
// It does NOT check uniqueness; that needs the database and lives in the service.
func ValidateCode(code string) error {
	if code == "" {
		return errors.New("referral code is required")
	}
	// Counted in runes: a multi-byte character would otherwise pass a byte-length
	// check and store a code longer than the UI can render.
	if n := len([]rune(code)); n < CodeMinLen || n > CodeMaxLen {
		return fmt.Errorf("referral code must be %d-%d characters, got %d", CodeMinLen, CodeMaxLen, n)
	}
	for _, r := range code {
		if !strings.ContainsRune(codeAllowed, r) {
			return fmt.Errorf(
				"referral code may only use A-Z and 0-9 (no spaces or punctuation); %q is not allowed",
				string(r))
		}
	}
	return nil
}

// Admin-chosen referral codes.
// An admin can replace a referrer's generated code with a memorable one
// ("JIDE1" on a flyer). The whole risk of that feature is COLLISION, and the
// check has to be wider than it first appears — see SetLinkCode.

// codeIssueAttempts bounds the retry when a generated code is already taken.
// Bounded, not infinite: if the space were somehow exhausted or the unique index
// were failing for another reason, an unbounded loop would spin forever inside a
// request instead of surfacing the problem.
const codeIssueAttempts = 8

// ErrCodeTaken means the requested code already belongs to someone.
var ErrCodeTaken = errors.New("referrals: code already in use")

// isDuplicateCode reports whether err is a unique violation on a code column.
// It deliberately does not distinguish WHICH unique index fired: on these tables
// the referrer_id conflicts are handled by ON CONFLICT clauses before this is
// reached, so a 23505 arriving here is a code clash.
func isDuplicateCode(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// codeOwner returns the user holding code, or "" if it is free.
// IT CHECKS BOTH TABLES, and that is the point. Attribution resolves a code by
// looking in referral_links FIRST and falling back to the legacy
// finance_referral_codes (see resolveCode). So if an admin were allowed to set a
// link code equal to some legacy user's code, every future signup typing that
// code would resolve to the NEW owner and the original owner would silently stop
// being credited — no error anywhere, just someone else's rewards. Checking one
// table would have shipped exactly that.
func (s *RewardService) codeOwner(ctx context.Context, code string) (string, error) {
	const q = `
		SELECT referrer_id::text FROM public.referral_links          WHERE code = $1
		UNION
		SELECT user_id::text     FROM public.finance_referral_codes  WHERE code = $1
		LIMIT 1`
	var owner string
	err := s.db.QueryRow(ctx, q, code).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("referrals: check code owner: %w", err)
	}
	return owner, nil
}

// SetLinkCode assigns an admin-chosen code to a referrer.
// Returns ErrCodeTaken if the code belongs to anyone else, in EITHER namespace.
// Re-assigning a referrer their own existing code is a no-op success, so a
// double-submit from the admin UI does not read as a failure.
func (s *RewardService) SetLinkCode(ctx context.Context, referrerID, rawCode string) (*Link, error) {
	code := NormalizeCode(rawCode)
	if err := ValidateCode(code); err != nil {
		return nil, err
	}

	// Make sure the referrer has a link row to update; also covers "admin edits
	// a user who has never opened the referral screen".
	if _, err := s.GetOrCreateLink(ctx, referrerID); err != nil {
		return nil, err
	}

	switch owner, err := s.codeOwner(ctx, code); {
	case err != nil:
		return nil, err
	case owner == referrerID:
		// Already theirs — nothing to do, and not an error.
		return s.GetOrCreateLink(ctx, referrerID)
	case owner != "":
		return nil, ErrCodeTaken
	}

	const upd = `
		UPDATE public.referral_links SET code = $2
		WHERE referrer_id = $1
		RETURNING id, referrer_id, code, created_at`
	var l Link
	err := s.db.QueryRow(ctx, upd, referrerID, code).Scan(&l.ID, &l.ReferrerID, &l.Code, &l.CreatedAt)
	if err != nil {
		// The read above is not a lock: another admin can claim the same code in
		// between. The unique index is the real guarantee, so translate its
		// violation into the same typed error rather than a 500.
		if isDuplicateCode(err) {
			return nil, ErrCodeTaken
		}
		return nil, fmt.Errorf("referrals: set code: %w", err)
	}
	return &l, nil
}
