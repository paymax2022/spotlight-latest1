package maps

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
)

// encrypt.go — at-rest encryption for PII-bearing gazetteer payloads (MS-4, NDPA).
//
// Addresses (and the raw components captured with a confirmed pin) are PII. The
// PrivateGazetteer stores any such payload ONLY in the encrypted_pii bytea column,
// never in plaintext. This file defines the Encryptor seam the Gazetteer depends
// on, an AES-256-GCM implementation, and a Noop impl for DB-free/dev paths.
//
// No existing crypto helper was found under internal/platform or internal/finance,
// so AES-256-GCM is implemented here with a random per-message nonce prefixed to
// the ciphertext (standard authenticated-encryption layout).

// Encryptor encrypts/decrypts a PII payload at rest. Implementations MUST be safe
// for concurrent use (the Gazetteer shares one instance across requests).
type Encryptor interface {
	Encrypt(plaintext []byte) ([]byte, error)
	Decrypt(ciphertext []byte) ([]byte, error)
}

// Crypto errors surfaced by the AES implementation.
var (
	// ErrEncryptorKeySize is returned by NewAESEncryptor for a key that is not a
	// valid AES key length (16/24/32 bytes). We require 32 (AES-256) in prod.
	ErrEncryptorKeySize = errors.New("maps: AES key must be 16, 24, or 32 bytes (32 = AES-256)")
	// ErrCiphertextTooShort is returned by Decrypt when the blob cannot hold a nonce.
	ErrCiphertextTooShort = errors.New("maps: ciphertext too short")
)

// aesEncryptor is an AES-GCM Encryptor. The nonce is randomly generated per call
// and prefixed to the returned ciphertext: layout = nonce || gcmSeal(plaintext).
type aesEncryptor struct {
	gcm cipher.AEAD
}

// NewAESEncryptor builds an AES-GCM Encryptor from a raw key. A 32-byte key
// selects AES-256 (the production default). Returns ErrEncryptorKeySize otherwise.
func NewAESEncryptor(key []byte) (Encryptor, error) {
	switch len(key) {
	case 16, 24, 32:
	default:
		return nil, fmt.Errorf("%w (got %d bytes)", ErrEncryptorKeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("maps: aes new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("maps: aes new gcm: %w", err)
	}
	return &aesEncryptor{gcm: gcm}, nil
}

// Encrypt returns nonce||ciphertext. Empty input yields empty output (nothing to
// store) so callers can pass a nil/empty PII payload without branching.
func (e *aesEncryptor) Encrypt(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, nil
	}
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("maps: nonce gen: %w", err)
	}
	// Seal appends the ciphertext to nonce, so the nonce prefixes the result.
	return e.gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt reverses Encrypt: it splits the nonce prefix and authenticates+decrypts.
// Empty input yields empty output (no stored PII).
func (e *aesEncryptor) Decrypt(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, nil
	}
	ns := e.gcm.NonceSize()
	if len(ciphertext) < ns {
		return nil, ErrCiphertextTooShort
	}
	nonce, body := ciphertext[:ns], ciphertext[ns:]
	plaintext, err := e.gcm.Open(nil, nonce, body, nil)
	if err != nil {
		return nil, fmt.Errorf("maps: aes open: %w", err)
	}
	return plaintext, nil
}

// NoopEncryptor is a pass-through Encryptor for tests and for environments where
// no key is configured. It NEVER protects PII — production wiring MUST inject a
// real AES key. It exists only so the Gazetteer is non-nil-fragile in dev/tests.
type NoopEncryptor struct{}

// Encrypt returns the input unchanged.
func (NoopEncryptor) Encrypt(plaintext []byte) ([]byte, error) { return plaintext, nil }

// Decrypt returns the input unchanged.
func (NoopEncryptor) Decrypt(ciphertext []byte) ([]byte, error) { return ciphertext, nil }

// compile-time interface assertions.
var (
	_ Encryptor = (*aesEncryptor)(nil)
	_ Encryptor = NoopEncryptor{}
)
