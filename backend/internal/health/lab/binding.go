package healthlab

import (
	"errors"
	"strings"
)

// ErrBarcodeMismatch signals a scanned barcode that does not match the sample's
// minted barcode on record — a possible tube swap or mislabel (EC-001/LB-005).
// Accessioning and result entry reject it: no result on an unverified
// sample↔patient bond (§4.3 "right patient, right result").
var ErrBarcodeMismatch = errors.New("lab: scanned barcode does not match the sample on record (possible mix-up) — recollection/verification required")

// normalizeBarcode canonicalizes a barcode for comparison (case + surrounding
// whitespace only; internal characters are significant).
func normalizeBarcode(b string) string { return strings.ToUpper(strings.TrimSpace(b)) }

// verifyBarcodeScan checks a scanned barcode against the sample's minted barcode.
// An empty scan means the step did not scan (backward-compatible for flows that
// don't) and passes; a non-empty scan MUST match the recorded barcode exactly
// (after normalization), else ErrBarcodeMismatch. A scan against a sample that has
// no recorded barcode is a mismatch — there is nothing to bind against.
func verifyBarcodeScan(scanned, expected string) error {
	if strings.TrimSpace(scanned) == "" {
		return nil
	}
	if normalizeBarcode(scanned) != normalizeBarcode(expected) {
		return ErrBarcodeMismatch
	}
	return nil
}

// authorizeOrderAccess is the pure object-level read decision for a lab order and
// its results/custody (LR-010, §4.6). Fail-closed: an empty requester is never
// authorized (guards the empty-requester/empty-owner fail-open); otherwise the
// data-subject patient, the owning lab, or an admin may read — everyone else is
// denied (cross-patient IDOR).
func authorizeOrderAccess(requesterID, patientID, labOwner string, isAdmin bool) bool {
	if strings.TrimSpace(requesterID) == "" {
		return false
	}
	if isAdmin {
		return true
	}
	return requesterID == patientID || (labOwner != "" && requesterID == labOwner)
}
