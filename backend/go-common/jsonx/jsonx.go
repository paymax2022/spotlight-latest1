// Package jsonx replaces the JSON marshal/unmarshal helpers copy-pasted
// across internal modules (toJSON, toJSONB, rawOrEmptyObject, marshalAmenities).
//
// The package is deliberately small: helpers either tolerate marshal errors
// (logging/audit payloads where loss beats failure) or surface them — the
// signatures make which behaviour you get explicit.
package jsonx

import (
	"bytes"
	"encoding/json"
)

// Marshal is json.Marshal returning nil on error — for audit/log payloads
// where a malformed value must not sink the enclosing operation.
func Marshal(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

// MarshalOr is Marshal with a caller-chosen fallback payload.
func MarshalOr(v any, fallback []byte) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return fallback
	}
	return b
}

// MarshalString is Marshal as a string — for text columns storing JSON.
func MarshalString(v any) string {
	return string(Marshal(v))
}

// MarshalArray encodes a slice, producing "[]" for nil — the
// marshalAmenities pattern: JSON array columns must never store "null".
func MarshalArray[T any](s []T) ([]byte, error) {
	if s == nil {
		return []byte("[]"), nil
	}
	return json.Marshal(s)
}

// MarshalObject encodes a map, producing "{}" for nil.
func MarshalObject[K comparable, V any](m map[K]V) ([]byte, error) {
	if m == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(m)
}

// RawOrEmptyObject returns raw or "{}" when raw is empty/nil — the
// rawOrEmptyObject pattern for jsonb columns that must decode as objects.
func RawOrEmptyObject(raw []byte) json.RawMessage {
	if len(bytes.TrimSpace(raw)) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(raw)
}

// RawOrEmptyArray is RawOrEmptyObject for array columns.
func RawOrEmptyArray(raw []byte) json.RawMessage {
	if len(bytes.TrimSpace(raw)) == 0 {
		return json.RawMessage("[]")
	}
	return json.RawMessage(raw)
}

// NullJSON returns nil for an empty payload so optional jsonb columns store
// SQL NULL, else the raw bytes — the db-side counterpart of RawOrEmptyObject.
func NullJSON(raw []byte) any {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	return raw
}

// UnmarshalOr unmarshals into v or leaves def in place on error/empty input —
// for scanned jsonb columns that tolerate blanks.
func UnmarshalOr[T any](data []byte, def T) T {
	if len(bytes.TrimSpace(data)) == 0 {
		return def
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return def
	}
	return v
}
