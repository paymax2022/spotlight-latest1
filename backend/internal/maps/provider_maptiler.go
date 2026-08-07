package maps

import (
	"context"
	"fmt"
)

// MapTiler is the OpenStack basemap/tile provider. It returns a MapLibre GL
// style URL + attribution. The API key is embedded server-side in the style URL
// proxied to the client; for stricter key hygiene point MapsTileStyleURL at a
// self-hosted style and swap provider in config (no code change).
type MapTiler struct {
	apiKey     string
	styleURL   string // optional explicit style override
	defaultMap string // MapTiler style id, e.g. "streets-v2"
}

// NewMapTiler builds the adapter. styleOverride wins when set.
func NewMapTiler(apiKey, styleOverride string) *MapTiler {
	return &MapTiler{apiKey: apiKey, styleURL: styleOverride, defaultMap: "streets-v2"}
}

func (m *MapTiler) Name() string { return "maptiler" }

// BasemapConfig returns the style + attribution for MapLibre GL.
func (m *MapTiler) BasemapConfig(_ context.Context, surface string) (StyleConfig, error) {
	style := m.styleURL
	if style == "" {
		style = fmt.Sprintf("https://api.maptiler.com/maps/%s/style.json?key=%s", m.defaultMap, m.apiKey)
	}
	return StyleConfig{
		StyleURL:    style,
		Attribution: "© MapTiler © OpenStreetMap contributors",
		Provider:    m.Name(),
		Source:      SourceOpenStack,
	}, nil
}

var _ TileProvider = (*MapTiler)(nil)
