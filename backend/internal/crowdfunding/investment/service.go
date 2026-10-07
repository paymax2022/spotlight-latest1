package investment

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/timeutil"
)

const (
	keyError = "error"
	keyData  = "data"
)

// Sentinel errors let the handler map failures to HTTP status codes.
var (
	ErrNotOnboarded   = errors.New("investment: onboarding incomplete (kyc, education, quiz and risk profile required)")
	ErrBelowMinTicket = errors.New("investment: amount is below the minimum ticket for this offer")
	ErrAnnualLimit    = errors.New("investment: subscription would exceed your annual investment limit")
	ErrOfferClosed    = errors.New("investment: offer is not open for subscription")
	ErrOfferNotFound  = errors.New("investment: offer not found")
	ErrBadRiskProfile = errors.New("investment: risk profile must be CONSERVATIVE, BALANCED or AGGRESSIVE")
	ErrBadStep        = errors.New("investment: unknown onboarding step")
	ErrAgreement      = errors.New("investment: risk warning and investor agreement must be accepted")
	// ErrIdempotencyKeyConflict — the caller's Idempotency-Key is already used
	// by ANOTHER member's subscription (409). Replay lookups are scoped to the
	// caller, so a foreign key cannot replay a stranger's certificate back; the
	// surviving unique-violation on insert is the durable proof of the clash
	// (same convention as finance/transfers' ErrIdempotencyKeyConflict).
	ErrIdempotencyKeyConflict = errors.New("investment: idempotency key already used by another subscription")
)

// Service holds the pgx pool. Money-path writes run inside transactions.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs an investment Service.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

const offerCols = `id, title, issuer_name, issuer_verified, model, summary, cover_image,
	target_kobo, raised_kobo, min_ticket_kobo, investor_count, status, closes_at,
	projected_return_pct, term_months, risk_level, lock_in_months, cooling_off_days,
	sector, location, offer_document_label`

func scanOffer(scan func(dest ...any) error) (InvestmentOffer, error) {
	var o InvestmentOffer
	var closesAt *time.Time
	err := scan(
		&o.ID, &o.Title, &o.IssuerName, &o.IssuerVerified, &o.Model, &o.Summary, &o.CoverImage,
		&o.TargetKobo, &o.RaisedKobo, &o.MinTicketKobo, &o.InvestorCount, &o.Status, &closesAt,
		&o.ProjectedReturnPct, &o.TermMonths, &o.RiskLevel, &o.LockInMonths, &o.CoolingOffDays,
		&o.Sector, &o.Location, &o.OfferDocumentLabel,
	)
	if err != nil {
		return o, err
	}
	if closesAt != nil {
		o.ClosesAt = timeutil.RFC3339Ptr(closesAt)
	}
	// Static disclosures the client renders; derived rather than stored.
	o.RiskWarnings = []string{
		"Your capital is at risk and you may get back less than you invested.",
		"Returns are indicative and not guaranteed.",
		fmt.Sprintf("Your money is locked in for up to %d months.", o.LockInMonths),
	}
	o.UseOfProceeds = []UseOfProceedsLine{
		{Label: "Working capital", AmountKobo: o.TargetKobo * 60 / 100},
		{Label: "Growth & marketing", AmountKobo: o.TargetKobo * 25 / 100},
		{Label: "Reserves", AmountKobo: o.TargetKobo * 15 / 100},
	}
	return o, nil
}

// GetOffers returns all offers ordered with open offers first.
func (s *Service) GetOffers(ctx context.Context) ([]InvestmentOffer, error) {
	sql := fmt.Sprintf(`SELECT %s FROM cf_investment_offers
		ORDER BY (status IN ('OPEN','CLOSING_SOON')) DESC, closes_at ASC NULLS LAST`, offerCols)
	rows, err := s.db.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvestmentOffer{}
	for rows.Next() {
		o, err := scanOffer(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// GetOffer returns a single offer by id.
func (s *Service) GetOffer(ctx context.Context, id string) (InvestmentOffer, error) {
	if _, err := uuid.Parse(id); err != nil {
		return InvestmentOffer{}, ErrOfferNotFound
	}
	sql := fmt.Sprintf(`SELECT %s FROM cf_investment_offers WHERE id = $1`, offerCols)
	o, err := scanOffer(s.db.QueryRow(ctx, sql, id).Scan)
	if errors.Is(err, pgx.ErrNoRows) {
		return InvestmentOffer{}, ErrOfferNotFound
	}
	return o, err
}

// GetProfile returns the caller's investor profile, materialising a default row
// (all gates false, default annual limit) if none exists yet.
func (s *Service) GetProfile(ctx context.Context, userID string) (InvestorProfile, error) {
	const ins = `
		INSERT INTO cf_investor_profiles (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, userID); err != nil {
		return InvestorProfile{}, err
	}
	return s.loadProfile(ctx, s.db, userID)
}

// querier abstracts pool vs tx for shared reads.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (s *Service) loadProfile(ctx context.Context, q querier, userID string) (InvestorProfile, error) {
	var p InvestorProfile
	var risk *string
	err := q.QueryRow(ctx, `
		SELECT onboarded, kyc_complete, education_complete, quiz_passed, risk_profile,
		       annual_limit_kobo, invested_this_year_kobo
		FROM cf_investor_profiles WHERE user_id = $1`, userID).Scan(
		&p.Onboarded, &p.KycComplete, &p.EducationComplete, &p.QuizPassed, &risk,
		&p.AnnualLimitKobo, &p.InvestedThisYearKobo,
	)
	if err != nil {
		return p, err
	}
	if risk != nil {
		rp := InvestorRiskProfile(*risk)
		p.RiskProfile = &rp
	}
	return p, nil
}

// CompleteOnboardingStep advances one onboarding gate. When all four gates
// (kyc, education, quiz, risk profile) are satisfied the profile flips onboarded.
func (s *Service) CompleteOnboardingStep(ctx context.Context, userID, step, riskProfile string) (InvestorProfile, error) {
	step = strings.TrimSpace(step)
	var col string
	switch step {
	case "kyc":
		col = "kyc_complete"
	case "education":
		col = "education_complete"
	case "quiz":
		col = "quiz_passed"
	case "riskProfile":
		col = "" // handled specially below
	default:
		return InvestorProfile{}, ErrBadStep
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return InvestorProfile{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `INSERT INTO cf_investor_profiles (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return InvestorProfile{}, err
	}

	if step == "riskProfile" {
		rp := strings.ToUpper(strings.TrimSpace(riskProfile))
		if rp != "CONSERVATIVE" && rp != "BALANCED" && rp != "AGGRESSIVE" {
			return InvestorProfile{}, ErrBadRiskProfile
		}
		if _, err := tx.Exec(ctx,
			`UPDATE cf_investor_profiles SET risk_profile=$1, updated_at=NOW() WHERE user_id=$2`,
			rp, userID); err != nil {
			return InvestorProfile{}, err
		}
	} else {
		// #nosec G201 -- col is from a fixed whitelist above, never user input.
		if _, err := tx.Exec(ctx,
			fmt.Sprintf(`UPDATE cf_investor_profiles SET %s=TRUE, updated_at=NOW() WHERE user_id=$1`, col),
			userID); err != nil {
			return InvestorProfile{}, err
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE cf_investor_profiles
		SET onboarded = (kyc_complete AND education_complete AND quiz_passed AND risk_profile IS NOT NULL),
		    updated_at = NOW()
		WHERE user_id = $1`, userID); err != nil {
		return InvestorProfile{}, err
	}

	p, err := s.loadProfile(ctx, tx, userID)
	if err != nil {
		return InvestorProfile{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return InvestorProfile{}, err
	}
	return p, nil
}

// GetEducation returns the seeded education modules in order.
func (s *Service) GetEducation(ctx context.Context) ([]EducationModule, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, title, body, minutes FROM cf_investor_education ORDER BY sort_order ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EducationModule{}
	for rows.Next() {
		var m EducationModule
		if err := rows.Scan(&m.ID, &m.Title, &m.Body, &m.Minutes); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetQuiz returns the seeded suitability quiz questions in order.
func (s *Service) GetQuiz(ctx context.Context) ([]QuizQuestion, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, question, options, correct_index FROM cf_investor_quiz ORDER BY sort_order ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuizQuestion{}
	for rows.Next() {
		var q QuizQuestion
		if err := rows.Scan(&q.ID, &q.Question, &q.Options, &q.CorrectIndex); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// Subscribe creates an investment subscription. It is fail-closed:
//   - the investor must have completed onboarding,
//   - the amount must meet the offer's minimum ticket,
//   - the cumulative annual investment must stay within the regulatory limit,
//   - the write is idempotent on idemKey (a replay returns the prior certificate).
//
// The whole operation runs in one transaction; the investor's
// invested_this_year_kobo and the offer counters are updated atomically.
func (s *Service) Subscribe(ctx context.Context, userID string, in InvestmentSubscriptionInput, idemKey string) (InvestmentCertificate, error) {
	if strings.TrimSpace(idemKey) == "" {
		return InvestmentCertificate{}, errors.New("investment: Idempotency-Key header is required")
	}
	if !in.AcceptedRisk || !in.AcceptedAgreement {
		return InvestmentCertificate{}, ErrAgreement
	}
	if in.AmountKobo <= 0 {
		return InvestmentCertificate{}, ErrBelowMinTicket
	}
	if _, err := uuid.Parse(in.OfferID); err != nil {
		return InvestmentCertificate{}, ErrOfferNotFound
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return InvestmentCertificate{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Idempotency: replay returns the existing certificate, never a second
	// insert. The lookup is CALLER-SCOPED (user_id): a key another member
	// already used must NOT replay their certificate back to this caller —
	// that would leak their offer/amount/holding. A foreign key misses here
	// and collides at the subscriptions unique constraint below → 409.
	if cert, ok, err := s.certByIdemKey(ctx, tx, userID, idemKey); err != nil {
		return InvestmentCertificate{}, err
	} else if ok {
		return cert, nil
	}

	var (
		offerTitle, issuerName, riskLevel string
		model                             InvestmentModel
		status                            OfferStatus
		minTicket, targetKobo             int64
		projectedReturnPct, lockInMonths  int
	)
	err = tx.QueryRow(ctx, `
		SELECT title, issuer_name, model, status, min_ticket_kobo, target_kobo,
		       projected_return_pct, lock_in_months, risk_level
		FROM cf_investment_offers WHERE id = $1 FOR UPDATE`, in.OfferID).Scan(
		&offerTitle, &issuerName, &model, &status, &minTicket, &targetKobo,
		&projectedReturnPct, &lockInMonths, &riskLevel)
	if errors.Is(err, pgx.ErrNoRows) {
		return InvestmentCertificate{}, ErrOfferNotFound
	}
	if err != nil {
		return InvestmentCertificate{}, err
	}
	if status != "OPEN" && status != "CLOSING_SOON" {
		return InvestmentCertificate{}, ErrOfferClosed
	}
	if in.AmountKobo < minTicket {
		return InvestmentCertificate{}, ErrBelowMinTicket
	}

	// Load + lock the investor profile (create default row if absent), enforce gates.
	if _, err := tx.Exec(ctx, `INSERT INTO cf_investor_profiles (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return InvestmentCertificate{}, err
	}
	var (
		onboarded                     bool
		annualLimit, investedThisYear int64
	)
	if err := tx.QueryRow(ctx, `
		SELECT onboarded, annual_limit_kobo, invested_this_year_kobo
		FROM cf_investor_profiles WHERE user_id = $1 FOR UPDATE`, userID).Scan(
		&onboarded, &annualLimit, &investedThisYear); err != nil {
		return InvestmentCertificate{}, err
	}
	if !onboarded {
		return InvestmentCertificate{}, ErrNotOnboarded
	}
	if investedThisYear+in.AmountKobo > annualLimit {
		return InvestmentCertificate{}, ErrAnnualLimit
	}

	unitsOrPct := computeUnitsOrPct(model, in.AmountKobo, targetKobo, projectedReturnPct)

	subID := uuid.New().String()
	reference := "SPL-INV-" + strings.ToUpper(subID[:8])
	now := time.Now().UTC()
	lockInUntil := now.AddDate(0, lockInMonths, 0)

	if _, err := tx.Exec(ctx, `
		INSERT INTO cf_investment_subscriptions
			(id, user_id, offer_id, amount_kobo, units_or_pct, reference, idempotency_key,
			 status, invested_at, lock_in_until)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9)`,
		subID, userID, in.OfferID, in.AmountKobo, unitsOrPct, reference, idemKey,
		now, lockInUntil); err != nil {
		// A 23505 here with the caller-scoped replay miss above is the durable
		// signal of a cross-user key clash — cf_investment_subscriptions
		// .idempotency_key is UNIQUE. Report it as a conflict rather than a
		// server fault (the M16 convention; a same-caller race loses nothing —
		// the retry replays the committed certificate).
		if dbutil.IsUniqueViolation(err) {
			return InvestmentCertificate{}, ErrIdempotencyKeyConflict
		}
		return InvestmentCertificate{}, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE cf_investor_profiles
		SET invested_this_year_kobo = invested_this_year_kobo + $1, updated_at = NOW()
		WHERE user_id = $2`, in.AmountKobo, userID); err != nil {
		return InvestmentCertificate{}, err
	}

	// Update offer projections (raised + investor count). raised_kobo here tracks
	// committed subscriptions for this regulated offer; it is recomputed additively.
	if _, err := tx.Exec(ctx, `
		UPDATE cf_investment_offers
		SET raised_kobo = raised_kobo + $1, investor_count = investor_count + 1
		WHERE id = $2`, in.AmountKobo, in.OfferID); err != nil {
		return InvestmentCertificate{}, err
	}

	cert := InvestmentCertificate{
		ID:          subID,
		Reference:   reference,
		OfferTitle:  offerTitle,
		IssuerName:  issuerName,
		AmountKobo:  in.AmountKobo,
		Model:       model,
		UnitsOrPct:  unitsOrPct,
		IssuedAt:    timeutil.RFC3339(now),
		LockInUntil: timeutil.RFC3339(lockInUntil),
	}
	if err := tx.Commit(ctx); err != nil {
		return InvestmentCertificate{}, err
	}
	return cert, nil
}

// certByIdemKey returns a prior certificate for the given idempotency key —
// scoped to THIS user. A key another member already used returns false here
// and is caught by the unique constraint on insert → ErrIdempotencyKeyConflict;
// an unscoped lookup would replay a stranger's certificate on a guessed key.
func (s *Service) certByIdemKey(ctx context.Context, tx pgx.Tx, userID, idemKey string) (InvestmentCertificate, bool, error) {
	var (
		cert                    InvestmentCertificate
		offerID                 string
		investedAt, lockInUntil *time.Time
		model                   InvestmentModel
		offerTitle, issuerName  string
	)
	err := tx.QueryRow(ctx, `
		SELECT sub.id, sub.amount_kobo, sub.units_or_pct, sub.reference, sub.offer_id,
		       sub.invested_at, sub.lock_in_until, o.title, o.issuer_name, o.model
		FROM cf_investment_subscriptions sub
		JOIN cf_investment_offers o ON o.id = sub.offer_id
		WHERE sub.idempotency_key = $1 AND sub.user_id = $2`, idemKey, userID).Scan(
		&cert.ID, &cert.AmountKobo, &cert.UnitsOrPct, &cert.Reference, &offerID,
		&investedAt, &lockInUntil, &offerTitle, &issuerName, &model)
	if errors.Is(err, pgx.ErrNoRows) {
		return InvestmentCertificate{}, false, nil
	}
	if err != nil {
		return InvestmentCertificate{}, false, err
	}
	cert.OfferTitle = offerTitle
	cert.IssuerName = issuerName
	cert.Model = model
	cert.IssuedAt = timeutil.RFC3339Ptr(investedAt)
	cert.LockInUntil = timeutil.RFC3339Ptr(lockInUntil)
	return cert, true, nil
}

// computeUnitsOrPct renders the human-readable holding line per investment model.
func computeUnitsOrPct(model InvestmentModel, amountKobo, targetKobo int64, projectedReturnPct int) string {
	switch model {
	case "EQUITY":
		pct := 0.0
		if targetKobo > 0 {
			pct = float64(amountKobo) / float64(targetKobo) * 100
		}
		return fmt.Sprintf("%.2f%% equity", pct)
	case "DEBT":
		return fmt.Sprintf("%s note @ %d%%", formatNaira(amountKobo), projectedReturnPct)
	case "REVENUE_SHARE":
		return fmt.Sprintf("%s revenue-share @ %d%%", formatNaira(amountKobo), projectedReturnPct)
	default:
		return formatNaira(amountKobo)
	}
}

// formatNaira renders kobo as a ₦ amount with thousands separators.
func formatNaira(kobo int64) string {
	naira := kobo / 100
	s := strconv.FormatInt(naira, 10)
	n := len(s)
	if n <= 3 {
		return "₦" + s
	}
	var b strings.Builder
	pre := n % 3
	if pre > 0 {
		b.WriteString(s[:pre])
		if n > pre {
			b.WriteString(",")
		}
	}
	for i := pre; i < n; i += 3 {
		b.WriteString(s[i : i+3])
		if i+3 < n {
			b.WriteString(",")
		}
	}
	return "₦" + b.String()
}

// GetPortfolio returns the caller's holdings. current_value is a simple mark using
// the offer's projected return prorated over elapsed lock-in time.
func (s *Service) GetPortfolio(ctx context.Context, userID string) ([]PortfolioHolding, error) {
	rows, err := s.db.Query(ctx, `
		SELECT sub.id, sub.offer_id, o.title, o.issuer_name, o.model,
		       sub.amount_kobo, sub.status, sub.invested_at, o.projected_return_pct, o.term_months
		FROM cf_investment_subscriptions sub
		JOIN cf_investment_offers o ON o.id = sub.offer_id
		WHERE sub.user_id = $1
		ORDER BY sub.invested_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PortfolioHolding{}
	for rows.Next() {
		var (
			h          PortfolioHolding
			investedAt time.Time
			returnPct  int
			termMonths int
		)
		if err := rows.Scan(&h.ID, &h.OfferID, &h.OfferTitle, &h.IssuerName, &h.Model,
			&h.InvestedKobo, &h.Status, &investedAt, &returnPct, &termMonths); err != nil {
			return nil, err
		}
		h.InvestedAt = timeutil.RFC3339(investedAt)
		h.CurrentValueKobo = markToValue(h.InvestedKobo, returnPct, termMonths, investedAt)
		out = append(out, h)
	}
	return out, rows.Err()
}

// markToValue computes an indicative current value: invested + accrued projected
// return prorated by the fraction of the term elapsed (capped at the full term).
func markToValue(invested int64, returnPct, termMonths int, investedAt time.Time) int64 {
	if termMonths <= 0 || returnPct <= 0 {
		return invested
	}
	elapsed := time.Since(investedAt).Hours() / 24 / 30 // months
	frac := elapsed / float64(termMonths)
	if frac < 0 {
		frac = 0
	}
	if frac > 1 {
		frac = 1
	}
	accrued := float64(invested) * float64(returnPct) / 100 * frac
	return invested + int64(accrued)
}

// Register wires the crowdfunding investment routes onto the supplied router
// group. The caller mounts `rg` under the crowdfunding prefix (so routes resolve
// to /api/finance/crowdfunding/investment/...) and applies auth middleware that
// sets `user_id`.
// Routes (relative to rg):
//
//	GET  /investment/profile      → caller's investor onboarding profile
//	POST /investment/onboarding   → advance one onboarding gate
//	GET  /investment/offers       → list investment offers
//	GET  /investment/offers/:id   → single offer detail
//	GET  /investment/education    → investor education modules
//	GET  /investment/quiz         → suitability quiz questions
//	POST /investment/subscribe    → subscribe (money mutation, Idempotency-Key)
//	GET  /investment/portfolio    → caller's holdings
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	inv := rg.Group("/investment")
	inv.GET("/profile", h.GetProfile)
	inv.POST("/onboarding", h.CompleteOnboarding)
	inv.GET("/offers", h.GetOffers)
	inv.GET("/offers/:id", h.GetOffer)
	inv.GET("/education", h.GetEducation)
	inv.GET("/quiz", h.GetQuiz)
	inv.POST("/subscribe", h.Subscribe)
	inv.GET("/portfolio", h.GetPortfolio)
}

// InvestmentModel mirrors the client union 'EQUITY' | 'DEBT' | 'REVENUE_SHARE'.
type InvestmentModel string

// InvestorRiskProfile mirrors 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'.
type InvestorRiskProfile string

// OfferStatus mirrors 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'FUNDED'.
type OfferStatus string

// UseOfProceedsLine is one row of an offer's use-of-proceeds breakdown.
type UseOfProceedsLine struct {
	Label      string `json:"label"`
	AmountKobo int64  `json:"amountKobo"`
}

// InvestmentOffer matches the client InvestmentOffer interface (camelCase).
type InvestmentOffer struct {
	ID                 string              `json:"id"`
	Title              string              `json:"title"`
	IssuerName         string              `json:"issuerName"`
	IssuerVerified     bool                `json:"issuerVerified"`
	Model              InvestmentModel     `json:"model"`
	Summary            string              `json:"summary"`
	CoverImage         *string             `json:"coverImage"`
	TargetKobo         int64               `json:"targetKobo"`
	RaisedKobo         int64               `json:"raisedKobo"`
	MinTicketKobo      int64               `json:"minTicketKobo"`
	InvestorCount      int                 `json:"investorCount"`
	Status             OfferStatus         `json:"status"`
	ClosesAt           string              `json:"closesAt"`
	ProjectedReturnPct int                 `json:"projectedReturnPct"`
	TermMonths         int                 `json:"termMonths"`
	RiskLevel          string              `json:"riskLevel"` // 'MEDIUM' | 'HIGH'
	LockInMonths       int                 `json:"lockInMonths"`
	CoolingOffDays     int                 `json:"coolingOffDays"`
	Sector             string              `json:"sector"`
	Location           string              `json:"location"`
	OfferDocumentLabel string              `json:"offerDocumentLabel"`
	RiskWarnings       []string            `json:"riskWarnings"`
	UseOfProceeds      []UseOfProceedsLine `json:"useOfProceeds"`
}

// InvestorProfile matches the client InvestorProfile interface.
type InvestorProfile struct {
	Onboarded            bool                 `json:"onboarded"`
	KycComplete          bool                 `json:"kycComplete"`
	EducationComplete    bool                 `json:"educationComplete"`
	QuizPassed           bool                 `json:"quizPassed"`
	RiskProfile          *InvestorRiskProfile `json:"riskProfile"`
	AnnualLimitKobo      int64                `json:"annualLimitKobo"`
	InvestedThisYearKobo int64                `json:"investedThisYearKobo"`
}

// EducationModule matches the client EducationModule interface.
type EducationModule struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Body    string `json:"body"`
	Minutes int    `json:"minutes"`
}

// QuizQuestion matches the client QuizQuestion interface.
type QuizQuestion struct {
	ID           string   `json:"id"`
	Question     string   `json:"question"`
	Options      []string `json:"options"`
	CorrectIndex int      `json:"correctIndex"`
}

// InvestmentSubscriptionInput matches the client InvestmentSubscriptionInput interface.
type InvestmentSubscriptionInput struct {
	OfferID           string `json:"offerId" binding:"required"`
	AmountKobo        int64  `json:"amountKobo" binding:"required,min=1"`
	AcceptedRisk      bool   `json:"acceptedRisk"`
	AcceptedAgreement bool   `json:"acceptedAgreement"`
}

// InvestmentCertificate matches the client InvestmentCertificate interface.
type InvestmentCertificate struct {
	ID          string          `json:"id"`
	Reference   string          `json:"reference"`
	OfferTitle  string          `json:"offerTitle"`
	IssuerName  string          `json:"issuerName"`
	AmountKobo  int64           `json:"amountKobo"`
	Model       InvestmentModel `json:"model"`
	UnitsOrPct  string          `json:"unitsOrPct"`
	IssuedAt    string          `json:"issuedAt"`
	LockInUntil string          `json:"lockInUntil"`
}

// PortfolioHolding matches the client PortfolioHolding interface.
type PortfolioHolding struct {
	ID               string          `json:"id"`
	OfferID          string          `json:"offerId"`
	OfferTitle       string          `json:"offerTitle"`
	IssuerName       string          `json:"issuerName"`
	Model            InvestmentModel `json:"model"`
	InvestedKobo     int64           `json:"investedKobo"`
	CurrentValueKobo int64           `json:"currentValueKobo"`
	Status           string          `json:"status"` // 'ACTIVE' | 'EXITED' | 'DEFAULTED'
	InvestedAt       string          `json:"investedAt"`
}

// OnboardingRequest is the POST /investment/onboarding body. `step` advances one
// onboarding gate at a time; `riskProfile` is required when step == "riskProfile".
type OnboardingRequest struct {
	Step        string `json:"step" binding:"required"` // kyc | education | quiz | riskProfile
	RiskProfile string `json:"riskProfile"`
}

// Handler adapts the investment Service to gin. List endpoints wrap results in
// gin.H{keyData: ...}; single-object endpoints return the object directly.
type Handler struct {
	svc *Service
}

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrBadStep, ErrBadRiskProfile),
	httperr.R(http.StatusNotFound, ErrOfferNotFound),
	// 409: the caller's Idempotency-Key is already used by ANOTHER member's
	// subscription — refuse, never replay a stranger's certificate back.
	httperr.R(http.StatusConflict, ErrIdempotencyKeyConflict),
	// 422: the request is well-formed but fails a business/regulatory rule.
	httperr.R(http.StatusUnprocessableEntity, ErrNotOnboarded, ErrAnnualLimit, ErrBelowMinTicket, ErrOfferClosed, ErrAgreement),
)

// NewHandler constructs an investment Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetProfile — GET /investment/profile.
func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, p)
}

// CompleteOnboarding — POST /investment/onboarding.
func (h *Handler) CompleteOnboarding(c *gin.Context) {
	var req OnboardingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.CompleteOnboardingStep(c.Request.Context(), ginutil.UserID(c), req.Step, req.RiskProfile)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetOffers — GET /investment/offers.
func (h *Handler) GetOffers(c *gin.Context) {
	items, err := h.svc.GetOffers(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: items})
}

// GetOffer — GET /investment/offers/:id.
func (h *Handler) GetOffer(c *gin.Context) {
	o, err := h.svc.GetOffer(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: "offer not found"})
		return
	}
	c.JSON(http.StatusOK, o)
}

// GetEducation — GET /investment/education.
func (h *Handler) GetEducation(c *gin.Context) {
	items, err := h.svc.GetEducation(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: items})
}

// GetQuiz — GET /investment/quiz.
func (h *Handler) GetQuiz(c *gin.Context) {
	items, err := h.svc.GetQuiz(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: items})
}

// Subscribe — POST /investment/subscribe. Money mutation: requires an
// Idempotency-Key header and enforces onboarding + annual-limit fail-closed.
func (h *Handler) Subscribe(c *gin.Context) {
	idemKey := ginutil.IdempotencyKey(c)
	if idemKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key header is required"})
		return
	}
	var in InvestmentSubscriptionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	cert, err := h.svc.Subscribe(c.Request.Context(), ginutil.UserID(c), in, idemKey)
	if err != nil {
		writeSubscribeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, cert)
}

// writeSubscribeErr maps Subscribe's domain errors onto HTTP statuses —
// extracted so the mapping is unit-testable without a database. errMap.Write
// carries no machine code, so the stable idempotency_key_conflict code is
// emitted explicitly (the transfer-rail contract).
func writeSubscribeErr(c *gin.Context, err error) {
	if errors.Is(err, ErrIdempotencyKeyConflict) {
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err), "code": "idempotency_key_conflict"})
		return
	}
	errMap.Write(c, err)
}

// GetPortfolio — GET /investment/portfolio.
func (h *Handler) GetPortfolio(c *gin.Context) {
	items, err := h.svc.GetPortfolio(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: items})
}
