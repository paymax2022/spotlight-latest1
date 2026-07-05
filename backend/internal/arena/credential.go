package arena

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// CredentialService primitives (ADR-014 §14, NDC-7). Credentials are issued only
// from Merit-derived state, are verifiable by a public hash, and are independently
// revocable without touching a user's unrelated Paymax capabilities.

// CredentialType is the kind of attestation.
type CredentialType string

const (
	CredCertifiedSafeDriver CredentialType = "CERTIFIED_SAFE_DRIVER" // Play-Along threshold
	CredNaijaDriver         CredentialType = "NAIJA_DRIVER"          // crown
)

// VerifiableHash is the public handle for a credential: a deterministic SHA-256
// over the issuing facts. Anyone can recompute it from the public credential
// fields to confirm the credential was issued from the stated merit reference.
func VerifiableHash(userID, competitionID string, t CredentialType, issuedFromMeritRef string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("arena-cred/v1|%s|%s|%s|%s",
		userID, competitionID, t, issuedFromMeritRef)))
	return hex.EncodeToString(sum[:])
}
