// Package ptr replaces the generic pointer/deref helpers copy-pasted across
// internal modules (ptrOrNil, deref, strPtr, orStr, ...). Everything is small
// generics — safe for any value type, no allocation beyond the pointer itself.
//
// Convention: Deref* reads optional (nullable) values toward a default,
// Ptr* manufactures pointers for optional DTO/request fields.
package ptr

// Of returns a pointer to v — the generic strPtr/intPtr replacement.
func Of[T any](v T) *T {
	return new(v)
}

// Deref reads p or returns def when p is nil — the generic deref/orStr.
func Deref[T any](p *T, def T) T {
	if p == nil {
		return def
	}
	return *p
}

// DerefZero reads p or the zero value — for when the natural default is the
// type's zero (most scanned-into-pointer columns).
func DerefZero[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

// Assign copies src into dst when src is non-nil — the deref(dst, src) patch
// helper used by partial-update repo code. dst must be non-nil.
func Assign[T any](dst *T, src *T) {
	if src != nil {
		*dst = *src
	}
}

// OrNil returns nil when v equals the zero value, else &v — the generic
// ptrOrNil for "empty means absent" semantics.
func OrNil[T comparable](v T) *T {
	var zero T
	if v == zero {
		return nil
	}
	return &v
}

// Map applies f to a non-nil pointer's value, preserving nil — replaces the
// repeated `if x != nil { v := f(*x); out = &v }` dance on optional fields.
func Map[T, U any](p *T, f func(T) U) *U {
	if p == nil {
		return nil
	}
	v := f(*p)
	return &v
}

// Equal reports whether two pointers are both nil or point at equal values.
func Equal[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// First returns the first non-nil pointer's value, or def — the pointer form
// of strutil.FirstNonEmpty for optional override chains (row > config > default).
func First[T any](def T, ps ...*T) T {
	for _, p := range ps {
		if p != nil {
			return *p
		}
	}
	return def
}

// All reports whether every pointer is non-nil — a compact guard for "the
// request supplied all optional fields" checks.
func All[T any](ps ...*T) bool {
	for _, p := range ps {
		if p == nil {
			return false
		}
	}
	return true
}

// Any reports whether at least one pointer is non-nil.
func Any[T any](ps ...*T) bool {
	for _, p := range ps {
		if p != nil {
			return true
		}
	}
	return false
}

// Slice converts a slice of values into a slice of pointers — for building
// patch DTOs where every field is independently optional.
func Slice[T any](vs []T) []*T {
	out := make([]*T, len(vs))
	for i := range vs {
		out[i] = &vs[i]
	}
	return out
}

// DerefSlice converts []*T to []T, skipping nils — the inverse of Slice for
// filtering optional lists down to present values.
func DerefSlice[T any](ps []*T) []T {
	out := make([]T, 0, len(ps))
	for _, p := range ps {
		if p != nil {
			out = append(out, *p)
		}
	}
	return out
}

// Index returns &s[i] or nil when i is out of range — replaces the bounds
// check + take-address pattern when selecting an optional element.
func Index[T any](s []T, i int) *T {
	if i < 0 || i >= len(s) {
		return nil
	}
	return &s[i]
}

// OrElse returns the first non-nil pointer, or def — pointer-first variant
// of First for chains that must preserve nil-ness until the end.
func OrElse[T any](def *T, ps ...*T) *T {
	for _, p := range ps {
		if p != nil {
			return p
		}
	}
	return def
}

// ZeroIfNil normalizes a nil pointer to the zero value — DerefZero spelled
// for readability at scan sites.
func ZeroIfNil[T any](p *T) T {
	return DerefZero(p)
}
