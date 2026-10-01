package jsonx_test

import (
	"testing"

	"spotlight/backend/go-common/jsonx"
)

func TestMarshal(t *testing.T) {
	if got := string(jsonx.Marshal(map[string]int{"a": 1})); got != `{"a":1}` {
		t.Fatalf("Marshal = %q", got)
	}
	// unmarshalable value → nil, never panics
	if got := jsonx.Marshal(func() {}); got != nil {
		t.Fatalf("Marshal(func) = %v, want nil", got)
	}
}

func TestMarshalOr(t *testing.T) {
	fb := []byte(`{"x":0}`)
	if got := jsonx.MarshalOr(func() {}, fb); string(got) != `{"x":0}` {
		t.Fatalf("MarshalOr fallback = %q", got)
	}
}

func TestMarshalArray_NilIsEmptyArray(t *testing.T) {
	var s []string
	b, err := jsonx.MarshalArray(s)
	if err != nil || string(b) != "[]" {
		t.Fatalf("MarshalArray(nil) = %q err=%v", b, err)
	}
	b, _ = jsonx.MarshalArray([]string{"a"})
	if string(b) != `["a"]` {
		t.Fatalf("MarshalArray = %q", b)
	}
}

func TestMarshalObject_NilIsEmptyObj(t *testing.T) {
	var m map[string]int
	b, err := jsonx.MarshalObject(m)
	if err != nil || string(b) != "{}" {
		t.Fatalf("MarshalObject(nil) = %q err=%v", b, err)
	}
}

func TestRawOrEmpty(t *testing.T) {
	if got := string(jsonx.RawOrEmptyObject(nil)); got != "{}" {
		t.Fatalf("RawOrEmptyObject(nil) = %q", got)
	}
	if got := string(jsonx.RawOrEmptyArray(nil)); got != "[]" {
		t.Fatalf("RawOrEmptyArray(nil) = %q", got)
	}
	if got := string(jsonx.RawOrEmptyObject([]byte(` {"a":1} `))); got != ` {"a":1} ` {
		t.Fatalf("RawOrEmptyObject passthrough = %q", got)
	}
}

func TestNullJSON(t *testing.T) {
	if jsonx.NullJSON(nil) != nil || jsonx.NullJSON([]byte("  ")) != nil {
		t.Fatal("NullJSON must be nil for empty")
	}
	if jsonx.NullJSON([]byte(`{"a":1}`)) == nil {
		t.Fatal("NullJSON passthrough failed")
	}
}

func TestUnmarshalOr(t *testing.T) {
	type cfg struct{ N int }
	if got := jsonx.UnmarshalOr([]byte(""), cfg{N: 9}); got.N != 9 {
		t.Fatal("empty input must return def")
	}
	if got := jsonx.UnmarshalOr([]byte("bad json"), cfg{N: 7}); got.N != 7 {
		t.Fatal("bad json must return def")
	}
	if got := jsonx.UnmarshalOr([]byte(`{"N":3}`), cfg{N: 7}); got.N != 3 {
		t.Fatal("valid json must decode")
	}
}

func TestDecode(t *testing.T) {
	v, err := jsonx.Decode[int]([]byte("5"))
	if err != nil || v != 5 {
		t.Fatalf("Decode = %v,%v", v, err)
	}
}

func TestCompact(t *testing.T) {
	if got := string(jsonx.Compact([]byte(`{ "a": 1 }`))); got != `{"a":1}` {
		t.Fatalf("Compact = %q", got)
	}
	bad := []byte("not json")
	if string(jsonx.Compact(bad)) != "not json" {
		t.Fatal("invalid input must pass through")
	}
}

func TestValid(t *testing.T) {
	if !jsonx.Valid([]byte(`{"a":1}`)) || jsonx.Valid([]byte("nope")) {
		t.Fatal("Valid wrong")
	}
}

func TestIndent(t *testing.T) {
	out := jsonx.Indent([]byte(`{"a":1}`))
	if len(out) == 0 {
		t.Fatal("Indent empty")
	}
	if string(jsonx.Indent([]byte("bad"))) != "bad" {
		t.Fatal("Indent invalid passthrough")
	}
}

func TestMergeObject(t *testing.T) {
	base := []byte(`{"a":1,"b":2}`)
	patch := []byte(`{"b":9,"c":3}`)
	got := string(jsonx.MergeObject(base, patch))
	if got == "" {
		t.Fatal("MergeObject empty")
	}
	// decode to verify merge
	var m map[string]int
	if err := jsonx.Unmarshal([]byte(got), &m); err != nil {
		t.Fatalf("merge output invalid: %v", err)
	}
	if m["a"] != 1 || m["b"] != 9 || m["c"] != 3 {
		t.Fatalf("merged = %v", m)
	}
	// invalid patch wins whole
	if string(jsonx.MergeObject(base, []byte("xxx"))) != "xxx" {
		t.Fatal("invalid patch must win whole")
	}
}

func TestStringify(t *testing.T) {
	if got := jsonx.Stringify(map[string]int{"k": 1}); got != `{"k":1}` {
		t.Fatalf("Stringify = %q", got)
	}
	if got := jsonx.Stringify(func() {}); got != "<unmarshalable>" {
		t.Fatalf("Stringify(func) = %q", got)
	}
}
