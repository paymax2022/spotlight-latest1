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

// ZeroIfNil normalizes a nil pointer to the zero value — DerefZero spelled
// for readability at scan sites.
func ZeroIfNil[T any](p *T) T {
	return DerefZero(p)
}
