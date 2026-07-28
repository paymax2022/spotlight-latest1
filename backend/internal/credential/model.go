package credential

import "time"

// Kind enumerates what a credential authorises. A single credential primitive
// backs event entry, cashless-wallet identity and loyalty perks (reuse across
// events + loyalty per TOP5-BUILD-PLAN §1).
type Kind string

const (
	KindEventTicket Kind = "event_ticket" // gate entry for a ticketed event
	KindWalletBand  Kind = "wallet_band"  // cashless event-wallet band / tag
	KindVendorPOS   Kind = "vendor_pos"   // vendor POS-lite identity at a gate/stall
	KindLoyaltyPerk Kind = "loyalty_perk" // a redeemable loyalty perk
	KindStewardPass Kind = "steward_pass" // staff/steward scanning capability
)

// State is the lifecycle of an issued credential.
type State string

const (
	StateActive  State = "ACTIVE"
	StateUsed    State = "USED"    // single-use credential already redeemed
	StateRevoked State = "REVOKED" // organiser/admin revoked it
	StateExpired State = "EXPIRED" // past valid_to
)

// Policy controls how a credential validates. It is stored with the credential so
// validation is self-describing (an offline gate can enforce it from the signed
// token alone, then reconcile later).
type Policy struct {
	SingleUse   bool          `json:"single_use"`   // true => one scan only (NL: QR single-use)
	AllowReentry bool         `json:"allow_reentry"` // re-entry: many scans, deduped per gate-window
	ReentryWindow time.Duration `json:"reentry_window"` // dedupe window for re-entry scans
	RotateTTL   time.Duration `json:"rotate_ttl"`   // QR rotates every RotateTTL (anti-screenshot)
	ValidFrom   time.Time     `json:"valid_from"`
	ValidTo     time.Time     `json:"valid_to"`
}

// Credential is the persisted issuance record. The on-the-wire token is signed and
// carries a rotating nonce; this row is the authority that the token references.
type Credential struct {
	ID         string    `json:"id"`
	SubjectRef string    `json:"subject_ref"` // owning user id (FK auth.users) or vendor id
	Kind       Kind      `json:"kind"`
	State      State     `json:"state"`
	Secret     string    `json:"-"`            // HMAC signing secret (never serialised out)
	Policy     Policy    `json:"policy"`
	NFCToken   string    `json:"nfc_token,omitempty"` // long-lived tap token (single-use enforced same path)
	IssuedAt   time.Time `json:"issued_at"`
	UsedAt     *time.Time `json:"used_at,omitempty"`
}

// Token is the rotating, signed value rendered as a QR (and an NFC payload). It is
// short-lived: window pins it to a RotateTTL bucket so a screenshot taken in one
// window is rejected in the next (anti-screenshot). The signature binds id+window+
// nonce so the token cannot be forged or replayed across windows.
type Token struct {
	CredentialID string `json:"cid"`
	Window       int64  `json:"w"`     // unix-time bucket = floor(now/rotateTTL)
	Nonce        string `json:"n"`     // per-window random nonce
	Sig          string `json:"sig"`   // HMAC-SHA256(secret, cid|window|nonce)
}

// Gate identifies where a validation happens (entry gate, stall, perk counter). It
// scopes re-entry dedupe and audit.
type Gate struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Result is the outcome of a Validate call.
type Result struct {
	OK           bool   `json:"ok"`
	CredentialID string `json:"credential_id"`
	SubjectRef   string `json:"subject_ref"`
	Kind         Kind   `json:"kind"`
	Reason       string `json:"reason,omitempty"` // populated when OK=false
	Reentry      bool   `json:"reentry"`          // true when accepted as a re-entry (not first use)
}

// Validation is an append-only scan record (one row per accepted/rejected scan).
// The offline-tolerant queue inserts PENDING rows that reconcile to ACCEPTED /
// REJECTED, so a brief gate outage never loses an entry event.
type Validation struct {
	ID           string    `json:"id"`
	CredentialID string    `json:"credential_id"`
	GateID       string    `json:"gate_id"`
	Window       int64     `json:"window"`
	Outcome      string    `json:"outcome"` // ACCEPTED | REJECTED | PENDING
	Reason       string    `json:"reason,omitempty"`
	ScannedAt    time.Time `json:"scanned_at"`
}

// Rejection reasons (stable strings for audit + client UX).
const (
	ReasonReplay      = "replay_rejected"   // token already used / window already consumed
	ReasonExpired     = "expired"
	ReasonNotYetValid = "not_yet_valid"
	ReasonBadSig      = "bad_signature"
	ReasonStaleWindow = "stale_window"      // screenshot from an older rotation window
	ReasonRevoked     = "revoked"
	ReasonNotFound    = "not_found"
)
