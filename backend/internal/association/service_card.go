package association

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Membership-card QR verification (MC-003/004/005). The QR is a compact,
// HMAC-signed token so a scanned card is tamper-evident and verifiable
// server-side. Format:
//
//	AMC1.<b64url(payload)>.<b64url(hmac_sha256(key, "AMC1."+b64url(payload)))>
//
// payload = {"m":membershipID,"c":memberCode,"o":orgID,"t":issuedUnix}. The token
// authenticates card authenticity; VerifyCard then does a LIVE status/standing
// lookup, so a revoked/expired/arrears card fails even with a genuine signature.
const cardTokenVersion = "AMC1"

// defaultDevCardKey is a fixed dev/local signing key. Production wiring MUST call
// SetCardSigningSecret to override it; if it isn't, cards signed on one host will
// still verify on another only while both use this default (dev convenience).
var defaultDevCardKey = func() []byte {
	sum := sha256.Sum256([]byte("assoc-card-hmac-dev-key-v1"))
	return sum[:]
}()

// SetCardSigningSecret derives the card HMAC key from a server secret (SHA-256,
// domain-separated). An empty secret is ignored so a misconfiguration cannot
// silently switch every card over to an empty-key signature.
func (s *Service) SetCardSigningSecret(secret string) {
	if strings.TrimSpace(secret) == "" {
		return
	}
	sum := sha256.Sum256([]byte("assoc-card-hmac-v1|" + secret))
	s.cardKey = sum[:]
}

func (s *Service) cardSigningKey() []byte {
	if len(s.cardKey) == 0 {
		return defaultDevCardKey
	}
	return s.cardKey
}

type cardTokenPayload struct {
	M string `json:"m"` // membership id (uuid) — the verify lookup key
	C string `json:"c"` // member code (display)
	O string `json:"o"` // organisation id
	T int64  `json:"t"` // issued-at, unix seconds
}

func (s *Service) signCardData(signingInput string) string {
	mac := hmac.New(sha256.New, s.cardSigningKey())
	mac.Write([]byte(signingInput))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// SignCardToken produces a signed QR token for a membership. Exported so GetCard
// and tests share one implementation.
func (s *Service) SignCardToken(membershipID, memberCode, orgID string) string {
	raw, _ := json.Marshal(cardTokenPayload{M: membershipID, C: memberCode, O: orgID, T: time.Now().Unix()})
	signingInput := cardTokenVersion + "." + base64.RawURLEncoding.EncodeToString(raw)
	return signingInput + "." + s.signCardData(signingInput)
}

// parseAndVerifyCardToken validates the token's structure + HMAC (constant-time)
// and returns the decoded payload. Fail-closed on any structural/signature error.
func (s *Service) parseAndVerifyCardToken(token string) (*cardTokenPayload, bool) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 || parts[0] != cardTokenVersion {
		return nil, false
	}
	signingInput := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(s.signCardData(signingInput)), []byte(parts[2])) {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var p cardTokenPayload
	if err := json.Unmarshal(raw, &p); err != nil || p.M == "" {
		return nil, false
	}
	return &p, true
}

// VerifyCard authenticates a scanned card QR token and returns the member's LIVE
// verification result. A structurally/cryptographically invalid token yields
// {Valid:false, Reason:"INVALID_SIGNATURE"} (a normal verification outcome, not an
// error). Only a DB failure returns an error. Because the status/standing is read
// live, a revoked/expired/arrears card fails even with a genuine signature
// (MC-002/004/005, EC-007).
func (s *Service) VerifyCard(ctx context.Context, token string) (*CardVerification, error) {
	res := &CardVerification{VerifiedAt: time.Now().UTC().Format(time.RFC3339)}
	p, ok := s.parseAndVerifyCardToken(token)
	if !ok {
		res.Reason = "INVALID_SIGNATURE"
		return res, nil
	}
	const q = `
		SELECT m.member_code, m.status, m.payment_standing,
		       (m.valid_through IS NOT NULL AND m.valid_through < now()) AS expired,
		       m.valid_through::text,
		       COALESCE(mp.full_name,''), o.name, o.acronym, COALESCE(mc.label,'Member')
		FROM assoc_memberships m
		JOIN assoc_organisations o ON o.id=m.organisation_id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		WHERE m.id=$1`
	var expired bool
	if err := s.db.QueryRow(ctx, q, p.M).Scan(
		&res.MemberID, &res.Status, &res.PaymentStanding, &expired, &res.ValidThrough,
		&res.FullName, &res.OrganisationName, &res.OrganisationAcronym, &res.CategoryLabel,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			res.Reason = "NOT_FOUND"
			return res, nil
		}
		return nil, fmt.Errorf("association: verify card lookup: %w", err)
	}

	// Authentic signature is necessary but NOT sufficient — the live record decides.
	switch {
	case res.Status == "SUSPENDED":
		res.Reason = "SUSPENDED"
	case res.Status == "EXPIRED" || expired:
		res.Reason = "EXPIRED"
	case res.Status != "ACTIVE":
		res.Reason = "REVOKED"
	case res.PaymentStanding == "OVERDUE":
		res.Reason = "ARREARS"
	default:
		res.Valid = true
	}
	return res, nil
}
