package maps

import "fmt"

// This file centralizes the HARD license-coherence rules so they are enforced
// in exactly one place and are trivially testable.
//
// Google's terms forbid (a) caching/persisting geocoding & Places results, and
// (b) displaying Google-sourced coordinates on a non-Google basemap. We keep the
// stacks coherent: OpenStack geocode -> OpenStack basemap; Google autocomplete/
// POI -> a Google map ONLY on that surface.

// isCacheableSource reports whether a result from this source may ever be
// persisted. Only OpenStack (OSM-licensed) and our own data are cacheable.
func isCacheableSource(s Source) bool {
	return s == SourceOpenStack || s == SourceOwn
}

// guardCacheWrite returns ErrNotCacheable if a result must never be persisted.
// The cache writer calls this before every INSERT — Google rows are refused.
func guardCacheWrite(r GeoResult) error {
	if !r.Cacheable || !isCacheableSource(r.Source) {
		return fmt.Errorf("%w (provider=%s source=%s)", ErrNotCacheable, r.Provider, r.Source)
	}
	return nil
}

// AssertRenderable is the runtime/dev guard the OpenStack/MapLibre renderer path
// calls before drawing any point. It THROWS (returns an error) if a Google- (or
// otherwise non-OSM-) sourced coordinate is about to be rendered on the
// OpenStack basemap. Keeping this server-side means the client can never receive
// a mismatched stack: the proxy refuses to emit it.
//
// basemapSource is the Source of the basemap the point will be drawn on.
func AssertRenderable(basemapSource Source, p Point) error {
	if basemapSource == SourceOpenStack && p.Source == SourceGoogle {
		return fmt.Errorf("%w (point.source=%s basemap.source=%s)", ErrLicenseCoherence, p.Source, basemapSource)
	}
	return nil
}

// assertCoherentResult guards a GeoResult about to be returned for rendering on
// the given basemap source.
func assertCoherentResult(basemapSource Source, r GeoResult) error {
	return AssertRenderable(basemapSource, r.Point())
}
