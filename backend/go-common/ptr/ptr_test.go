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

func TestMap(t *testing.T) {
	double := func(i int) int { return i * 2 }
	if ptr.Map((*int)(nil), double) != nil {
		t.Fatal("Map(nil) must be nil")
	}
	v := 3
	got := ptr.Map(&v, double)
	if got == nil || *got != 6 {
		t.Fatalf("Map(3) = %v", got)
	}
}

func TestEqual(t *testing.T) {
	a, b := ptr.Of(1), ptr.Of(1)
	c := ptr.Of(2)
	if !ptr.Equal(a, b) {
		t.Fatal("Equal(1,1) must be true")
	}
	if ptr.Equal(a, c) {
		t.Fatal("Equal(1,2) must be false")
	}
	if !ptr.Equal[int](nil, nil) {
		t.Fatal("Equal(nil,nil) must be true")
	}
	if ptr.Equal(a, nil) || ptr.Equal(nil, b) {
		t.Fatal("Equal with one nil must be false")
	}
}

func TestFirst(t *testing.T) {
	if got := ptr.First("d", nil, ptr.Of("w"), ptr.Of("x")); got != "w" {
		t.Fatalf("First = %q, want w", got)
	}
	if got := ptr.First("d", nil, nil); got != "d" {
		t.Fatalf("First all-nil = %q, want d", got)
	}
}

func TestAllAny(t *testing.T) {
	p := ptr.Of(1)
	if !ptr.All(p, ptr.Of(2)) || ptr.All(p, nil) {
		t.Fatal("All wrong")
	}
	if !ptr.Any(nil, p) || ptr.Any[int](nil, nil) {
		t.Fatal("Any wrong")
	}
}

func TestSliceAndDerefSlice(t *testing.T) {
	ps := ptr.Slice([]int{1, 2, 3})
	if len(ps) != 3 || *ps[0] != 1 {
		t.Fatal("Slice failed")
	}
	back := ptr.DerefSlice([]*int{ps[0], nil, ps[2]})
	if len(back) != 2 || back[0] != 1 || back[1] != 3 {
		t.Fatalf("DerefSlice = %v", back)
	}
}

func TestIndex(t *testing.T) {
	s := []string{"a", "b"}
	if got := ptr.Index(s, 1); got == nil || *got != "b" {
		t.Fatal("Index(1) failed")
	}
	if ptr.Index(s, 5) != nil || ptr.Index(s, -1) != nil {
		t.Fatal("Index out of range must be nil")
	}
}

func TestOrElse(t *testing.T) {
	def := ptr.Of("d")
	if got := ptr.OrElse(def, nil, ptr.Of("x")); *got != "x" {
		t.Fatal("OrElse must return first non-nil")
	}
	if got := ptr.OrElse(def, nil); *got != "d" {
		t.Fatal("OrElse must fall back to def")
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
