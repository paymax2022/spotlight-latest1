package healthlab

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Directory, catalog-detail and review reads/writes for the Lab vertical. Every
// value here is persisted — the mobile app used to fake the lab directory, the
// per-test/package detail and the reviews on the client.

const testColumns = `id, lab_provider_id, code, name, specimen, prep_instructions, tat_hours, ref_range,
	price_kobo, active, created_at, category, description, home_collection, fasting_required`

func scanTest(row pgx.Row) (Test, error) {
	var t Test
	err := row.Scan(&t.ID, &t.LabProviderID, &t.Code, &t.Name, &t.Specimen, &t.PrepInstructions,
		&t.TATHours, &t.RefRange, &t.PriceKobo, &t.Active, &t.CreatedAt, &t.Category,
		&t.Description, &t.HomeCollection, &t.FastingRequired)
	return t, err
}

var (
	ErrTestNotFound      = errors.New("lab: test not found")
	ErrPackageNotFound   = errors.New("lab: package not found")
	ErrLabNotFound       = errors.New("lab: lab not found")
	ErrReviewNotEligible = errors.New("lab: you can review an order once its results have been released")
	ErrAlreadyReviewed   = errors.New("lab: this order has already been reviewed")
	ErrInvalidRating     = errors.New("lab: rating must be between 1 and 5")
	ErrReviewBodyTooLong = errors.New("lab: review must be 2000 characters or fewer")
)

// LabCredential is the lab's MLSCN licence as the credential vault records it.
type LabCredential struct {
	Authority string     `json:"authority"`
	LicenseNo string     `json:"license_no"`
	Status    string     `json:"status"` // verified | pending | expired
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

// Lab is one entry in the patient-facing directory.
type Lab struct {
	ID                     string        `json:"id"`
	Name                   string        `json:"name"`
	Headline               string        `json:"headline"`
	Address                string        `json:"address"`
	SupportsHomeCollection bool          `json:"supports_home_collection"`
	SupportsWalkIn         bool          `json:"supports_walk_in"`
	HomeCollectionFeeKobo  int64         `json:"home_collection_fee_kobo"`
	ResultETALabel         string        `json:"result_eta_label"`
	Lat                    float64       `json:"lat"`
	Lng                    float64       `json:"lng"`
	DistanceM              *float64      `json:"distance_m,omitempty"`
	Rating                 float64       `json:"rating"`
	ReviewCount            int           `json:"review_count"`
	Credential             LabCredential `json:"credential"`
}

// Review is a verified-purchase lab review.
type Review struct {
	ID        string    `json:"id"`
	Author    string    `json:"author"`
	Rating    int       `json:"rating"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

// labSelect lists APPROVED lab providers with their profile, review aggregate and
// MLSCN credential. $1 homeOnly, $2 lng, $3 lat (distance is NULL without a point).
const labSelect = `
	SELECT p.id, p.display_name,
	       COALESCE(lp.headline,''), COALESCE(lp.address,''),
	       COALESCE(lp.supports_home_collection,false), COALESCE(lp.supports_walk_in,true),
	       COALESCE(lp.home_collection_fee_kobo,0), COALESCE(lp.result_eta_label,''),
	       COALESCE(ST_Y(p.geo::geometry),0), COALESCE(ST_X(p.geo::geometry),0),
	       CASE WHEN $2::float8 IS NULL OR $3::float8 IS NULL OR p.geo IS NULL THEN NULL
	            ELSE ST_Distance(p.geo, ST_SetSRID(ST_MakePoint($2::float8,$3::float8),4326)::geography) END AS dist_m,
	       COALESCE(rv.avg_rating,0), COALESCE(rv.n,0),
	       COALESCE(cr.reference_no,''), COALESCE(cr.verified,false), cr.expires_at
	FROM health_providers p
	LEFT JOIN lab_profiles lp ON lp.lab_provider_id = p.id
	LEFT JOIN LATERAL (
		SELECT ROUND(AVG(r.rating)::numeric,1)::float8 AS avg_rating, COUNT(*)::int AS n
		FROM lab_reviews r WHERE r.lab_provider_id = p.id) rv ON true
	LEFT JOIN LATERAL (
		SELECT d.reference_no, d.verified, d.expires_at
		FROM health_credential_docs d
		JOIN health_provider_applications a ON a.id = d.application_id
		WHERE a.provider_id = p.id AND d.cred_type = 'MLSCN'
		ORDER BY d.verified DESC, d.created_at DESC LIMIT 1) cr ON true
	WHERE p.domain = 'LAB' AND p.provider_type = 'lab' AND p.status = 'APPROVED'
	  AND ($1::bool = false OR COALESCE(lp.supports_home_collection,false))`

func (s *Service) queryLabs(ctx context.Context, extraWhere string, order string, args ...any) ([]Lab, error) {
	rows, err := s.db.Query(ctx, labSelect+extraWhere+order, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Lab{}
	now := time.Now()
	for rows.Next() {
		var l Lab
		var licence string
		var verified bool
		var expires *time.Time
		if err := rows.Scan(&l.ID, &l.Name, &l.Headline, &l.Address, &l.SupportsHomeCollection,
			&l.SupportsWalkIn, &l.HomeCollectionFeeKobo, &l.ResultETALabel, &l.Lat, &l.Lng,
			&l.DistanceM, &l.Rating, &l.ReviewCount, &licence, &verified, &expires); err != nil {
			return nil, err
		}
		status := "pending"
		switch {
		case expires != nil && expires.Before(now):
			status = "expired"
		case verified:
			status = "verified"
		}
		l.Credential = LabCredential{Authority: "MLSCN", LicenseNo: licence, Status: status, ExpiresAt: expires}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ListLabs is the discoverable directory (HL-2: only APPROVED + discoverable labs).
// lng/lat are optional; with them the list is nearest-first.
func (s *Service) ListLabs(ctx context.Context, homeOnly bool, lng, lat *float64) ([]Lab, error) {
	return s.queryLabs(ctx, ` AND p.discoverable`, ` ORDER BY dist_m NULLS LAST, p.display_name ASC LIMIT 100`, homeOnly, lng, lat)
}

// GetLab returns one APPROVED lab — discoverable or not, so a patient can still
// open the lab of an order they already placed.
func (s *Service) GetLab(ctx context.Context, id string) (*Lab, error) {
	labs, err := s.queryLabs(ctx, ` AND p.id = $4::uuid`, ` LIMIT 1`, false, (*float64)(nil), (*float64)(nil), id)
	if err != nil {
		return nil, err
	}
	if len(labs) == 0 {
		return nil, ErrLabNotFound
	}
	return &labs[0], nil
}

// GetTest returns one active catalog test.
func (s *Service) GetTest(ctx context.Context, id string) (*Test, error) {
	t, err := scanTest(s.db.QueryRow(ctx, `SELECT `+testColumns+` FROM lab_tests WHERE id = $1 AND active = true`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTestNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetPackage returns one active package.
func (s *Service) GetPackage(ctx context.Context, id string) (*Package, error) {
	var p Package
	err := s.db.QueryRow(ctx, `
		SELECT id, lab_provider_id, name, description, prep_instructions, tat_hours, price_kobo, test_ids, active, created_at
		FROM lab_packages WHERE id = $1 AND active = true`, id).
		Scan(&p.ID, &p.LabProviderID, &p.Name, &p.Description, &p.PrepInstructions,
			&p.TATHours, &p.PriceKobo, &p.TestIDs, &p.Active, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPackageNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ListReviews returns a lab's reviews, newest first. Authors are shown as a first
// name plus initial — never a full name or contact detail.
func (s *Service) ListReviews(ctx context.Context, labID string) ([]Review, error) {
	rows, err := s.db.Query(ctx, `
		SELECT r.id, COALESCE(NULLIF(btrim(up.full_name),''), NULLIF(btrim(up.display_name),''), ''),
		       r.rating, r.body, r.created_at
		FROM lab_reviews r
		LEFT JOIN user_profiles up ON up.id = r.author_id
		WHERE r.lab_provider_id = $1
		ORDER BY r.created_at DESC LIMIT 50`, labID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Review{}
	for rows.Next() {
		var rv Review
		var full string
		var rating int16
		if err := rows.Scan(&rv.ID, &full, &rating, &rv.Body, &rv.CreatedAt); err != nil {
			return nil, err
		}
		rv.Rating = int(rating)
		rv.Author = shortAuthor(full)
		out = append(out, rv)
	}
	return out, rows.Err()
}

func shortAuthor(full string) string {
	parts := strings.Fields(full)
	switch len(parts) {
	case 0:
		return "Patient"
	case 1:
		return parts[0]
	default:
		return fmt.Sprintf("%s %c.", parts[0], []rune(parts[len(parts)-1])[0])
	}
}

// SubmitReview records the caller's review of a lab for one of THEIR orders. The
// lab is derived from the order (never the client), the order must be released,
// and an order can be reviewed once. Missing-or-not-yours is the uniform
// ErrOrderNotFound so the endpoint is not an order-existence oracle.
func (s *Service) SubmitReview(ctx context.Context, userID, orderID string, rating int, body string) (*Review, error) {
	if rating < 1 || rating > 5 {
		return nil, ErrInvalidRating
	}
	body = strings.TrimSpace(body)
	if len([]rune(body)) > 2000 {
		return nil, ErrReviewBodyTooLong
	}
	var labID, state string
	err := s.db.QueryRow(ctx,
		`SELECT lab_provider_id, state FROM lab_orders WHERE id = $1 AND patient_id = $2`,
		orderID, userID).Scan(&labID, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "RELEASED" && state != "CLOSED" {
		return nil, ErrReviewNotEligible
	}
	var rv Review
	var r int16
	err = s.db.QueryRow(ctx, `
		INSERT INTO lab_reviews (lab_provider_id, order_id, author_id, rating, body)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (order_id) DO NOTHING
		RETURNING id, rating, body, created_at`,
		labID, orderID, userID, rating, body).Scan(&rv.ID, &r, &rv.Body, &rv.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAlreadyReviewed
	}
	if err != nil {
		return nil, err
	}
	rv.Rating = int(r)
	var full string
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(NULLIF(btrim(full_name),''), NULLIF(btrim(display_name),''), '') FROM user_profiles WHERE id = $1`, userID).Scan(&full)
	rv.Author = shortAuthor(full)
	s.audited(userID, "", "health.lab.review.submit", orderID, nil,
		map[string]any{"lab_provider_id": labID, "rating": rating})
	return &rv, nil
}
