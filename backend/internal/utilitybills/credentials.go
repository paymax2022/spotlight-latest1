package utilitybills

// This file ports frontend-web/src/server/utility/credentials.ts (90 lines)
// BIT-FOR-BIT. It is not a "reimplementation with the same idea": rows already
// sitting in public.utility_providers.credentials were encrypted by the Node
// code, and if this port derives the key even slightly differently they stop
// decrypting — silently, at the first live provider call, with a generic
// "message authentication failed" that says nothing about why.
//
// Two places where a naive Go port WOULD diverge, handled explicitly below:
//
//  1. Key derivation is a 3-way guess at what the operator put in
//     UTILITY_PROVIDER_CREDENTIALS_KEY (64-char hex → base64-of-32-bytes →
//     sha256-of-the-raw-string). The base64 branch is the trap: Node's
//     Buffer.from(s, 'base64') is LENIENT (it skips characters outside the
//     alphabet, accepts the URL-safe alphabet, and tolerates missing padding),
//     whereas Go's encoding/base64 is strict and errors. A passphrase that Node
//     happens to decode into exactly 32 bytes takes the base64 branch there and
//     would take the sha256 branch here — producing a different key and a dead
//     credential row. nodeBase64Decode below reproduces Node's leniency.
//
//  2. Node's crypto splits the GCM auth tag out of the ciphertext
//     (cipher.getAuthTag()); Go's cipher.AEAD expects ciphertext||tag as one
//     slice. The envelope's `tag` field is therefore appended on decrypt and
//     split off on encrypt.

import (
	"crypto/aes"
	"crypto/cipher"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Envelope constants, byte-identical to credentials.ts's ALGORITHM / KEY_ID.
const (
	CredentialsAlgorithm = "aes-256-gcm"
	CredentialsKeyID     = "utility-provider-credentials:v1"
)

// Credential errors.
var (
	// ErrCredentialsKeyMissing mirrors credentials.ts's
	// "UTILITY_PROVIDER_CREDENTIALS_KEY is required..." 500.
	ErrCredentialsKeyMissing = errors.New("utilitybills: UTILITY_PROVIDER_CREDENTIALS_KEY is required before reading or storing utility provider credentials")
	// ErrCredentialsNotEncrypted is returned when a credentials JSONB value is
	// present but is not one of our envelopes (e.g. a legacy plaintext object).
	ErrCredentialsNotEncrypted = errors.New("utilitybills: provider credentials are not an encrypted envelope")
)

// EncryptedCredentials is the on-disk envelope stored in
// public.utility_providers.credentials. Field names/tags match the TS interface
// exactly — the JSONB column is read and written by both implementations during
// the migration window, so a renamed key would break the other side.
type EncryptedCredentials struct {
	Encrypted  bool   `json:"encrypted"`
	Algorithm  string `json:"algorithm"`
	KeyID      string `json:"key_id"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
	Ciphertext string `json:"ciphertext"`
	UpdatedAt  string `json:"updated_at"`
}

// isHex64 reports whether raw matches credentials.ts's /^[a-f0-9]{64}$/i.
func isHex64(raw string) bool {
	if len(raw) != 64 {
		return false
	}
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		switch {
		case c >= '0' && c <= '9':
		case c >= 'a' && c <= 'f':
		case c >= 'A' && c <= 'F':
		default:
			return false
		}
	}
	return true
}

// nodeBase64Decode reproduces Node's Buffer.from(s, 'base64') decoding, which is
// deliberately forgiving where Go's encoding/base64 is strict:
//
//   - characters outside the base64 alphabet (including '=', whitespace and
//     punctuation) are SKIPPED rather than treated as an error;
//   - the URL-safe alphabet is accepted in the same pass ('-' → '+', '_' → '/');
//   - a truncated final group is decoded as far as it goes (2 chars → 1 byte,
//     3 chars → 2 bytes, a lone trailing char contributes nothing).
//
// It never returns an error: Node never throws here either, it just returns a
// shorter Buffer, and the CALLER's length check (== 32) is what decides whether
// the base64 branch applies at all.
func nodeBase64Decode(raw string) []byte {
	// Collect only alphabet characters, normalising the URL-safe variants.
	filtered := make([]byte, 0, len(raw))
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/':
			filtered = append(filtered, c)
		case c == '-':
			filtered = append(filtered, '+')
		case c == '_':
			filtered = append(filtered, '/')
		default:
			// Skipped, exactly like Node.
		}
	}

	// Decode whole 4-character groups, then whatever partial group remains.
	whole := len(filtered) - len(filtered)%4
	out := make([]byte, 0, len(filtered)*3/4+2)
	if whole > 0 {
		buf := make([]byte, base64.StdEncoding.DecodedLen(whole))
		n, err := base64.StdEncoding.Decode(buf, filtered[:whole])
		if err != nil {
			// Unreachable: every byte in `filtered` is in the standard alphabet and
			// the slice length is a multiple of 4. Treated as "decodes to nothing"
			// rather than panicking, so a malformed key can only ever fall through
			// to the sha256 branch.
			return nil
		}
		out = append(out, buf[:n]...)
	}
	switch rest := filtered[whole:]; len(rest) {
	case 2:
		padded := append(append([]byte{}, rest...), '=', '=')
		buf := make([]byte, base64.StdEncoding.DecodedLen(len(padded)))
		if n, err := base64.StdEncoding.Decode(buf, padded); err == nil {
			out = append(out, buf[:n]...)
		}
	case 3:
		padded := append(append([]byte{}, rest...), '=')
		buf := make([]byte, base64.StdEncoding.DecodedLen(len(padded)))
		if n, err := base64.StdEncoding.Decode(buf, padded); err == nil {
			out = append(out, buf[:n]...)
		}
	}
	return out
}

// DeriveCredentialsKey ports credentials.ts's getEncryptionKey(): a 64-char hex
// string is decoded as hex; otherwise a value that base64-decodes to exactly 32
// bytes is used verbatim; otherwise the raw string is treated as a passphrase and
// hashed with sha256. The ambiguity is inherited from the TS source and MUST be
// preserved — an existing deployment's key could be any of the three shapes, and
// only reproducing the same order picks the same 32 bytes it did.
//
// Takes the key material as an argument rather than reading os.Getenv, so it is
// unit-testable with zero environment coupling (the env read happens once at
// wiring time — see app/utilitybills_routes.go).
func DeriveCredentialsKey(raw string) ([]byte, error) {
	if raw == "" {
		return nil, ErrCredentialsKeyMissing
	}
	if isHex64(raw) {
		if b, err := hex.DecodeString(raw); err == nil {
			return b, nil
		}
	}
	if decoded := nodeBase64Decode(raw); len(decoded) == 32 {
		return decoded, nil
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}

// IsEncryptedCredentials mirrors credentials.ts's isEncryptedProviderCredentials:
// an object with encrypted === true and the expected algorithm. Anything else
// (null, a plaintext object, an envelope from another algorithm) is not ours.
func IsEncryptedCredentials(rawJSON []byte) bool {
	if len(rawJSON) == 0 {
		return false
	}
	var env EncryptedCredentials
	if err := json.Unmarshal(rawJSON, &env); err != nil {
		return false
	}
	return env.Encrypted && env.Algorithm == CredentialsAlgorithm
}

// EncryptCredentials ports encryptProviderCredentials: a fresh random 12-byte IV
// per call (NEVER reused — GCM's security collapses under IV reuse with the same
// key), AES-256-GCM over the JSON serialisation, and the auth tag stored beside
// the ciphertext rather than concatenated onto it.
func EncryptCredentials(key []byte, credentials map[string]any) (*EncryptedCredentials, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: credentials cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: credentials gcm: %w", err)
	}
	iv := make([]byte, gcm.NonceSize()) // 12 bytes, matching randomBytes(12)
	if _, err := crand.Read(iv); err != nil {
		return nil, fmt.Errorf("utilitybills: credentials iv: %w", err)
	}
	plaintext, err := json.Marshal(credentials)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: credentials marshal: %w", err)
	}

	// Go returns ciphertext||tag; Node keeps them apart. Split at the tag size.
	sealed := gcm.Seal(nil, iv, plaintext, nil)
	tagSize := gcm.Overhead()
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	return &EncryptedCredentials{
		Encrypted:  true,
		Algorithm:  CredentialsAlgorithm,
		KeyID:      CredentialsKeyID,
		IV:         base64.StdEncoding.EncodeToString(iv),
		Tag:        base64.StdEncoding.EncodeToString(tag),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
		UpdatedAt:  time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}, nil
}

// DecryptCredentials ports decryptProviderCredentials. The envelope's IV, tag and
// ciphertext are base64 — decoded with Node's lenient rules for the same reason
// the key is (these strings were written by Node and are well-formed, but the
// lenient decoder is a strict superset of the strict one, so it can only ever
// accept more).
func DecryptCredentials(key []byte, env *EncryptedCredentials) (map[string]any, error) {
	if env == nil {
		return nil, ErrCredentialsNotEncrypted
	}
	if !env.Encrypted || env.Algorithm != CredentialsAlgorithm {
		return nil, ErrCredentialsNotEncrypted
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: credentials cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: credentials gcm: %w", err)
	}

	iv := nodeBase64Decode(env.IV)
	if len(iv) != gcm.NonceSize() {
		return nil, fmt.Errorf("utilitybills: credentials iv is %d bytes, expected %d", len(iv), gcm.NonceSize())
	}
	ciphertext := nodeBase64Decode(env.Ciphertext)
	tag := nodeBase64Decode(env.Tag)
	if len(tag) != gcm.Overhead() {
		return nil, fmt.Errorf("utilitybills: credentials auth tag is %d bytes, expected %d", len(tag), gcm.Overhead())
	}

	plaintext, err := gcm.Open(nil, iv, append(append([]byte{}, ciphertext...), tag...), nil)
	if err != nil {
		// Deliberately vague to the caller but specific in the wrap: the most likely
		// cause by far is a WRONG KEY (one of the three derivation branches picked
		// differently from whatever encrypted the row), not a corrupt row.
		return nil, fmt.Errorf("utilitybills: credentials decrypt failed (wrong UTILITY_PROVIDER_CREDENTIALS_KEY?): %w", err)
	}

	var out map[string]any
	if err := json.Unmarshal(plaintext, &out); err != nil {
		return nil, fmt.Errorf("utilitybills: credentials unmarshal: %w", err)
	}
	return out, nil
}

// DecryptCredentialsJSON is the convenience form used by the repository: it takes
// the raw JSONB column value, and returns (nil, nil) when the column is NULL or
// not one of our envelopes — a provider with no stored credentials falls back to
// the process-level environment configuration rather than failing.
func DecryptCredentialsJSON(key []byte, rawJSON []byte) (map[string]any, error) {
	if len(rawJSON) == 0 || string(rawJSON) == "null" {
		return nil, nil
	}
	if !IsEncryptedCredentials(rawJSON) {
		return nil, nil
	}
	var env EncryptedCredentials
	if err := json.Unmarshal(rawJSON, &env); err != nil {
		return nil, fmt.Errorf("utilitybills: credentials envelope: %w", err)
	}
	return DecryptCredentials(key, &env)
}

// CredentialString reads one string field out of a decrypted credentials map,
// returning "" when absent or not a string. Never logs the value.
func CredentialString(creds map[string]any, key string) string {
	if creds == nil {
		return ""
	}
	if v, ok := creds[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
