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
