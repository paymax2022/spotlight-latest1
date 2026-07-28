import React, { useEffect, useState } from 'react';
import { ActivityIndicator, NativeModules, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { getBasemap, type MapSource, type MapStyleConfig } from '../api/maps.api';

// @maplibre/maplibre-react-native throws at module-init time when its native binary
// is absent (Expo Go / JS-only builds). Lazy-require it so the crash is caught here
// instead of propagating before any component can render a fallback.
//
// ┌─ Enabling the real interactive map (already declared, just needs a build) ──┐
// │ The dependency (@maplibre/maplibre-react-native ^10.4.2) and its Expo config │
// │ plugin (see app.json → expo.plugins) are BOTH present. MapLibre GL is a      │
// │ native module, so it does NOT run in Expo Go — it needs a custom dev-client  │
// │ or a release build. To turn the real GL map on:                             │
// │   1. npx expo install @maplibre/maplibre-react-native   (already installed)  │
// │   2. Ensure "@maplibre/maplibre-react-native" is in app.json plugins (it is) │
// │   3. Build a dev client / app:                                              │
// │        eas build --profile development --platform ios|android               │
// │        (or:  npx expo run:ios  /  npx expo run:android  for a local build)   │
// │   4. Launch that build (NOT Expo Go). NativeModules.MLRNModule is then set   │
// │      and this component renders live tiles from getBasemap()'s style URL.    │
// │ No provider API key ships in the app — the basemap style URL comes from the  │
// │ backend maps proxy. In Expo Go, MobilityMap degrades to MapPlaceholder,      │
// │ which renders a real OSM (Leaflet-in-WebView) map so dev still sees tiles.   │
// └─────────────────────────────────────────────────────────────────────────────┘
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapLibreGL: any = null;
const MAP_NATIVE_AVAILABLE = !!NativeModules.MLRNModule;
if (MAP_NATIVE_AVAILABLE) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    MapLibreGL = require('@maplibre/maplibre-react-native').default;
  } catch {
    // Native module missing — placeholder rendered below
  }
}

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  color?: string;
  /** A 'google'-sourced marker is REFUSED on the OpenStack basemap (client mirror
   *  of the server license-coherence guard). */
  source?: MapSource;
}

export interface MapViewProps {
  surface?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  onPress?: (lat: number, lng: number) => void;
  onReady?: (basemapSource: MapSource) => void;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/**
 * MapView is the MapLibre GL renderer for mobile, fed by getBasemapConfig()
 * (style URL + attribution) from our backend. It never talks to a provider
 * directly and enforces license coherence: a Google-sourced marker is not drawn
 * on the OpenStack basemap.
 */
export default function MapView({
  surface = 'default',
  center = { lat: 6.4541, lng: 3.3947 }, // Lagos
  zoom = 12,
  markers = [],
  onPress,
  onReady,
  style,
  children,
}: MapViewProps) {
  const [cfg, setCfg] = useState<MapStyleConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBasemap(surface)
      .then((c) => {
        if (cancelled) return;
        setCfg(c);
        onReady?.(c.source);
      })
      .catch(() => !cancelled && setError('Could not load basemap'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  // In Expo Go (no custom dev-client), the native binary isn't available.
  // Show a static placeholder so the rest of the screen still renders.
  if (!MAP_NATIVE_AVAILABLE) {
    return (
      <View style={[styles.container, styles.center, styles.placeholder, style]}>
        <Text style={styles.placeholderIcon}>🗺</Text>
        <Text style={styles.placeholderText}>Map unavailable in Expo Go</Text>
        <Text style={styles.placeholderSub}>Run a custom dev-client to enable MapLibre</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center, style]}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!cfg) {
    return (
      <View style={[styles.container, styles.center, style]}>
        <ActivityIndicator />
      </View>
    );
  }

  const basemapSource = cfg.source;

  return (
    <View style={[styles.container, style]}>
      <MapLibreGL.MapView
        style={styles.map}
        mapStyle={cfg.style_url}
        logoEnabled={false}
        attributionEnabled
        onPress={(feature: any) => {
          const coords = feature?.geometry?.coordinates;
          if (coords && onPress) onPress(coords[1], coords[0]); // [lng,lat] → lat,lng
        }}
      >
        <MapLibreGL.Camera
          zoomLevel={zoom}
          centerCoordinate={[center.lng, center.lat]}
          animationDuration={400}
        />

        {markers.map((m) => {
          if (basemapSource === 'openstack' && m.source === 'google') {
            // License coherence: never render a Google point on OSM tiles.
            // eslint-disable-next-line no-console
            console.error('MapView: refusing to render a Google-sourced marker on the OpenStack basemap', m);
            return null;
          }
          return (
            <MapLibreGL.PointAnnotation key={m.id} id={m.id} coordinate={[m.lng, m.lat]} title={m.title}>
              <View style={[styles.pin, { backgroundColor: m.color || '#2563eb' }]} />
            </MapLibreGL.PointAnnotation>
          );
        })}

        {children}
      </MapLibreGL.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 320, borderRadius: 8, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  placeholder: { backgroundColor: '#e8edf5', gap: 4 },
  placeholderIcon: { fontSize: 32 },
  placeholderText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  placeholderSub: { fontSize: 11, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 24 },
  map: { flex: 1 },
  error: { color: '#b91c1c' },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
