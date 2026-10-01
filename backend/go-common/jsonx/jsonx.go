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
	"maps"
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

// Unmarshal is json.Unmarshal with the two-value form made explicit — exists
// so call sites read `jsonx.Unmarshal(b, &v)` beside Marshal.
func Unmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
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

// Decode unmarshals a json.RawMessage field into T — typed access over
// interface{} payloads in event/audit rows.
func Decode[T any](raw json.RawMessage) (T, error) {
	var v T
	err := json.Unmarshal(raw, &v)
	return v, err
}

// Compact normalizes raw JSON (whitespace-stripped). Invalid input is
// returned unchanged — callers decide whether invalid JSON is an error.
func Compact(raw []byte) []byte {
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return raw
	}
	return buf.Bytes()
}

// Valid reports whether raw is well-formed JSON — the pre-check used before
// inserting into jsonb columns to fail fast instead of at the driver.
func Valid(raw []byte) bool {
	return json.Valid(bytes.TrimSpace(raw))
}

// Indent pretty-prints raw JSON for admin/debug surfaces. Invalid input is
// returned unchanged.
func Indent(raw []byte) []byte {
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		return raw
	}
	return buf.Bytes()
}

// MergeObject shallow-merges patch fields into a base JSON object — for
// "update some keys of a stored jsonb column" without a full rewrite. Both
// inputs must be objects; on any error the patch wins whole (the caller's
// explicit intent).
func MergeObject(base, patch []byte) []byte {
	var b, p map[string]any
	if err := json.Unmarshal(base, &b); err != nil {
		b = map[string]any{}
	}
	if err := json.Unmarshal(patch, &p); err != nil {
		return patch
	}
	maps.Copy(b, p)
	out, err := json.Marshal(b)
	if err != nil {
		return patch
	}
	return out
}

// Stringify marshals v for logs — never fails, renders invalid values as
// their fmt-ish zero so a log line is never dropped.
func Stringify(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "<unmarshalable>"
	}
	return string(b)
}
