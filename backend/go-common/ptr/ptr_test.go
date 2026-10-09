package ptr_test

import (
	"testing"

	"spotlight/backend/go-common/ptr"
)

func TestOf(t *testing.T) {
	p := ptr.Of(42)
	if p == nil || *p != 42 {
		t.Fatal("Of(42) failed")
	}
	s := ptr.Of("x")
	if *s != "x" {
		t.Fatal("Of(string) failed")
	}
}

func TestDeref(t *testing.T) {
	if got := ptr.Deref((*int)(nil), 9); got != 9 {
		t.Fatalf("Deref(nil,9) = %d", got)
	}
	v := 5
	if got := ptr.Deref(&v, 9); got != 5 {
		t.Fatalf("Deref(&5,9) = %d", got)
	}
}

func TestDerefZero(t *testing.T) {
	if got := ptr.DerefZero((*string)(nil)); got != "" {
		t.Fatalf("DerefZero(nil) = %q", got)
	}
	s := "hi"
	if got := ptr.DerefZero(&s); got != "hi" {
		t.Fatalf("DerefZero(&hi) = %q", got)
	}
}

func TestAssign(t *testing.T) {
	dst := "old"
	src := "new"
	ptr.Assign(&dst, &src)
	if dst != "new" {
		t.Fatalf("Assign: dst = %q", dst)
	}
	var nilSrc *string
	dst = "keep"
	ptr.Assign(&dst, nilSrc)
	if dst != "keep" {
		t.Fatal("Assign with nil src must not overwrite")
	}
}

func TestOrNil(t *testing.T) {
	if ptr.OrNil("") != nil {
		t.Fatal("OrNil(\"\") must be nil")
	}
	if ptr.OrNil(0) != nil {
		t.Fatal("OrNil(0) must be nil")
	}
	p := ptr.OrNil("x")
	if p == nil || *p != "x" {
		t.Fatal("OrNil(x) must point at x")
	}
}

func TestZeroIfNil(t *testing.T) {
	if ptr.ZeroIfNil((*int)(nil)) != 0 {
		t.Fatal("ZeroIfNil(nil) must be 0")
	}
	v := 8
	if ptr.ZeroIfNil(&v) != 8 {
		t.Fatal("ZeroIfNil(&8) must be 8")
	}
}
