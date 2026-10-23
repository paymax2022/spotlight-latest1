package kycverify

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"spotlight/backend/internal/finance/namematch"
)

// idTypeField is stamped into an ID-number check's extracted_fields when it is
// stored, so later readers know which ID the name came from. Checks stored
// before it existed have no ID type ("legacy").
const idTypeField = "_id_type"

// ownershipVerifiedField is stamped "true" only when the ownership gate actually
// ran on the check and kept its PASS — so a check that passed while the gate was
// off can never become an identity anchor after the gate is switched on.
const ownershipVerifiedField = "_ownership_verified"

// VerifiedLegalName returns the legal name the identity provider returned on
// the user's PASSED ID-number checks, and whether it is STRONG enough to trust
// without a person looking.
//
// It reads verification_check, never user_profiles: the profile's full_name is
// usually the name typed at signup.
//
// The name is anchored on the EARLIEST passed check whose ownership the gate
// actually proved (a BVN/NIN/vNIN check stored with _ownership_verified=true —
// the only ID types FEATURE_KYC_OWNERSHIP_GATE can tie to the caller), falling
// back to the earliest passed check of any type. It is never
// "the latest", because a later check can be run on someone else's passport or
// driver's licence, which no ownership proof covers.
//
// strong is true only when an anchored check exists AND every passed ID-number
// check agrees with its name. A legacy-only identity, or one with a conflicting
// check, is returned with strong=false: usable as context, never for automatic
// approval. ok is false when the user has no passed ID-number check.
func (r *Repository) VerifiedLegalName(ctx context.Context, userID string) (name string, strong bool, ok bool, err error) {
	rows, err := r.db.Query(ctx, `
		SELECT extracted_fields FROM verification_check
		WHERE user_id = $1 AND type = 'ID_NUMBER' AND status = 'PASSED'
		ORDER BY updated_at ASC`, userID)
	if err != nil {
		return "", false, false, fmt.Errorf("kycverify: read verified name: %w", err)
	}
	defer rows.Close()
	var names []string
	anchor := ""
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return "", false, false, fmt.Errorf("kycverify: scan verified name: %w", err)
		}
		fields, err := stringFields(raw)
		if err != nil {
			return "", false, false, err
		}
		n := legalNameFromFields(fields)
		if n == "" {
			continue
		}
		names = append(names, n)
		if anchor == "" && isPhoneBearingIDType(strings.ToLower(fields[idTypeField])) && fields[ownershipVerifiedField] == "true" {
			anchor = n
		}
	}
	if err := rows.Err(); err != nil {
		return "", false, false, fmt.Errorf("kycverify: read verified name: %w", err)
	}
	if len(names) == 0 {
		return "", false, false, nil
	}
	if anchor == "" {
		return names[0], false, true, nil
	}
	for _, n := range names {
		if !sameIdentity(n, anchor) {
			return anchor, false, true, nil
		}
	}
	return anchor, true, true, nil
}

// sameIdentity reports whether two provider names are the same person, allowing
// one to carry a middle name the other lacks.
func sameIdentity(a, b string) bool {
	return namematch.Match(a, b).Outcome == namematch.Matched || namematch.Match(b, a).Outcome == namematch.Matched
}

func stringFields(raw []byte) (map[string]string, error) {
	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return nil, fmt.Errorf("kycverify: decode verified name: %w", err)
	}
	fields := make(map[string]string, len(generic))
	for k, v := range generic {
		if s, ok := v.(string); ok {
			fields[k] = s
		}
	}
	return fields, nil
}

// legalNameFromFields prefers the provider's full name (it carries the middle
// name), else joins first, middle and last.
func legalNameFromFields(fields map[string]string) string {
	if full := firstNonEmpty(fields, "full_name", "fullName", "fullname"); full != "" {
		return full
	}
	return strings.TrimSpace(strings.Join(nonEmpty(
		firstNonEmpty(fields, "first_name", "firstName", "firstname"),
		firstNonEmpty(fields, "middle_name", "middleName", "middlename"),
		firstNonEmpty(fields, "last_name", "lastName", "lastname", "surname"),
	), " "))
}
