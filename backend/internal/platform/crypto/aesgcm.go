// Package crypto provides authenticated symmetric encryption for PII at rest.
//
// KYC stores selfies, ID documents, and government bio-data. Per the KYC PRD
// (NDPA 2023 + CBN), these raw provider payloads must be encrypted at rest with
// AES-256. This helper wraps AES-256-GCM (authenticated encryption): the key is a
// base64-encoded 32-byte value supplied via config (KYC_PII_ENC_KEY), never
// hard-coded and never sent to a client. The output is self-describing
// (nonce ‖ ciphertext ‖ tag), base64-encoded for storage in a text/blob column.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// ErrKeyLength is returned when the configured key is not exactly 32 bytes.
var ErrKeyLength = errors.New("crypto: AES-256 key must decode to exactly 32 bytes")

// Cipher encrypts/decrypts PII blobs with AES-256-GCM.
type Cipher struct {
	aead cipher.AEAD
}

// NewCipherFromBase64Key builds a Cipher from a base64-encoded 32-byte key.
func NewCipherFromBase64Key(b64Key string) (*Cipher, error) {
	key, err := base64.StdEncoding.DecodeString(b64Key)
	if err != nil {
		return nil, fmt.Errorf("crypto: key is not valid base64: %w", err)
	}
	if len(key) != 32 {
		return nil, ErrKeyLength
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt seals plaintext and returns base64(nonce ‖ ciphertext ‖ tag).
// `aad` is optional additional authenticated data (e.g. the record id) that is
// authenticated but not encrypted; pass nil if unused. It must match on Decrypt.
func (c *Cipher) Encrypt(plaintext, aad []byte) (string, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, plaintext, aad)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt. `aad` must equal the value used at encryption time.
func (c *Cipher) Decrypt(b64 string, aad []byte) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("crypto: ciphertext is not valid base64: %w", err)
	}
	ns := c.aead.NonceSize()
	if len(raw) < ns {
		return nil, errors.New("crypto: ciphertext too short")
	}
	nonce, ct := raw[:ns], raw[ns:]
	return c.aead.Open(nil, nonce, ct, aad)
}
