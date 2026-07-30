package cac

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// sandboxProvider is a deterministic, offline stub used when CAC credentials are
// absent so dev/CI stay functional without the accredited VAS gateway. Its outputs
// are a pure function of the inputs — the SAME name always resolves the same way,
// and a derived ref is stable — so tests are reproducible. It NEVER performs I/O and
// NEVER panics. It is NOT used when real credentials are configured (see New).
type sandboxProvider struct{}

func (s *sandboxProvider) Name() string { return "cac-sandbox" }

// CheckNameAvailability marks names containing common blocked tokens as taken/
// restricted and everything else available, deterministically.
func (s *sandboxProvider) CheckNameAvailability(ctx context.Context, proposedName, lineOfBusiness string) (Availability, error) {
	name := strings.ToLower(strings.TrimSpace(proposedName))
	if name == "" {
		return Availability{Available: false, Status: "review", Reason: "empty name"}, nil
	}
	for _, restricted := range []string{"federal", "national", "government", "cbn", "central bank"} {
		if strings.Contains(name, restricted) {
			return Availability{Available: false, Status: "restricted", Reason: "contains a restricted term: " + restricted}, nil
		}
	}
	// Deterministic "already taken" bucket: ~1 in 4 names by hash parity.
	if hashByte(name)%4 == 0 {
		return Availability{
			Available:   false,
			Status:      "taken",
			Reason:      "a similar name already exists",
			Suggestions: []string{proposedName + " Ventures", proposedName + " Global", proposedName + " NG"},
		}, nil
	}
	return Availability{Available: true, Status: "available"}, nil
}

func (s *sandboxProvider) ReserveName(ctx context.Context, proposedName string, applicant Applicant) (Reservation, error) {
	ref := "SBX-RSV-" + shortHash(proposedName+applicant.Email)
	return Reservation{Ref: ref, ExpiresAt: time.Now().Add(60 * 24 * time.Hour)}, nil
}

func (s *sandboxProvider) SubmitRegistration(ctx context.Context, req RegistrationRequest) (Submission, error) {
	ref := "SBX-REG-" + shortHash(req.ProposedName+req.ReservationRef)
	// Sandbox accepts into review; a subsequent GetRegistrationStatus resolves it.
	return Submission{Ref: ref, Status: "under_review"}, nil
}

func (s *sandboxProvider) GetRegistrationStatus(ctx context.Context, ref string) (RegistrationStatus, error) {
	// Deterministic terminal outcome so a poll eventually resolves. Refs whose hash
	// is divisible by 7 "reject"; everything else registers with a derived number.
	if hashByte(ref)%7 == 0 {
		return RegistrationStatus{State: "rejected", Reason: "sandbox: name conflict on final review"}, nil
	}
	num := "BN" + fmt.Sprintf("%07d", int(hashByte(ref))<<12|int(hashByte(ref+"x")))
	return RegistrationStatus{
		State:          "registered",
		RCOrBNNumber:   num[:9],
		CertificateURL: "https://sandbox.vas.cac.gov.ng/certificates/" + num[:9] + ".pdf",
	}, nil
}

func (s *sandboxProvider) VerifyEntity(ctx context.Context, rcOrBnNumber string) (EntityVerification, error) {
	num := strings.ToUpper(strings.TrimSpace(rcOrBnNumber))
	if num == "" {
		return EntityVerification{Found: false}, nil
	}
	// Deterministic "not found" bucket so the verify path exercises both branches.
	if hashByte(num)%5 == 0 {
		return EntityVerification{Found: false}, nil
	}
	typ := "business_name"
	if strings.HasPrefix(num, "RC") {
		typ = "company"
	}
	return EntityVerification{
		Found:        true,
		Name:         "Sandbox Enterprises " + shortHash(num),
		Status:       "active",
		Type:         typ,
		RegisteredAt: "2020-01-15",
	}, nil
}

func hashByte(s string) byte {
	h := sha256.Sum256([]byte(s))
	return h[0]
}

func shortHash(s string) string {
	h := sha256.Sum256([]byte(s))
	return strings.ToUpper(hex.EncodeToString(h[:4]))
}
