import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin, Navigation } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { LatLng } from '../types/mobility.types';

interface Props {
  height?: number;
  caption?: string;
  showRoute?: boolean;
  style?: ViewStyle;
  /** Pickup / origin pin (secondary colour). */
  pickup?: LatLng | null;
  /** Drop-off / destination pin (primary colour). */
  dropoff?: LatLng | null;
  /** Live driver / courier position pin (tertiary colour). */
  driver?: LatLng | null;
  /** Optional [lng,lat] route to draw (matches MobilityMap's route prop). */
  route?: [number, number][] | null;
}

/**
 * Fallback map surface used when the native MapLibre GL module is unavailable
 * (Expo Go / JS-only builds). Rather than a purely decorative grid, when any
 * pickup / drop-off / driver coordinate is supplied it renders a REAL map with
 * OpenStreetMap raster tiles, markers and a route polyline via Leaflet inside a
 * `react-native-webview` (already a project dependency, used by PaymentSheet) —
 * so dev builds show an actual location instead of a faux grid, with no extra
 * native module. The interactive GL map still comes from MapView/MobilityMap in
 * a custom dev-client / EAS build (see MapView.tsx); this only degrades cleanly
 * when that native binary is absent.
 *
 * The decorative gradient/grid remains the ultimate fallback: on web (no
 * react-native-webview map here) and when no coordinates are available.
 */
export default function MapPlaceholder({
  height = 200,
  caption,
  showRoute,
  style,
  pickup,
  dropoff,
  driver,
  route,
}: Props) {
  const hasCoords = !!(pickup || dropoff || driver);
  // Native (iOS/Android): Leaflet OSM map inside react-native-webview.
  const canRenderWebView = hasCoords && Platform.OS !== 'web';

  const html = useMemo(
    () => (hasCoords ? buildLeafletHtml({ pickup, dropoff, driver, route }) : ''),
    [hasCoords, pickup, dropoff, driver, route],
  );

  // Web: react-native-web renders intrinsic DOM elements, so we mount the exact
  // same Leaflet document in a real <iframe> — a genuine interactive OSM map
  // (pan, tiles, pickup/drop-off markers, route) instead of the decorative grid.
  if (hasCoords && Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, { height }, style]}>
        {React.createElement('iframe', {
          srcDoc: html,
          title: caption || 'Map',
          loading: 'lazy',
          style: { border: 0, width: '100%', height: '100%', display: 'block' },
        })}
        {caption ? (
          <View style={styles.captionWrap} pointerEvents="none">
            <Text style={styles.caption}>{caption}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (canRenderWebView) {
    return (
      <View style={[styles.wrap, { height }, style]}>
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={styles.web}
          scrollEnabled={false}
          scalesPageToFit={false}
          javaScriptEnabled
          domStorageEnabled
          // Tiles are the only network dependency; everything else is inline.
          androidLayerType="hardware"
        />
        {caption ? (
          <View style={styles.captionWrap} pointerEvents="none">
            <Text style={styles.caption}>{caption}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }, style]}>
      <LinearGradient
        colors={[Colors.surfaceContainer, Colors.surfaceContainerHighest]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* faux grid */}
      <View style={styles.grid} pointerEvents="none">
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: `${(i + 1) * 16}%` }]} />
        ))}
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLineV, { left: `${(i + 1) * 16}%` }]} />
        ))}
      </View>

      {showRoute && (
        <>
          <View style={[styles.pin, { top: '28%', left: '24%' }]}>
            <View style={styles.pinDotStart} />
          </View>
          <View style={styles.routeLine} />
          <View style={[styles.pin, { bottom: '24%', right: '22%' }]}>
            <MapPin size={26} color={Colors.primary} strokeWidth={2.2} fill={Colors.primaryFixed} />
          </View>
        </>
      )}

      {!showRoute && (
        <View style={styles.center}>
          <Navigation size={26} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
        </View>
      )}

      {caption ? (
        <View style={styles.captionWrap}>
          <Text style={styles.caption}>{caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Leaflet (OSM raster) HTML for the WebView fallback ─────────────────────────
// Self-contained document: pulls Leaflet from a CDN and OSM tiles at runtime.
// Markers use the brand colours; the route is the [lng,lat] polyline from the
// tracking hook (flipped to Leaflet's [lat,lng]). No API key — OSM tiles only.
function buildLeafletHtml(opts: {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  driver?: LatLng | null;
  route?: [number, number][] | null;
}): string {
  const { pickup, dropoff, driver, route } = opts;
  const dot = (lat: number, lng: number, color: string) =>
    `L.circleMarker([${lat},${lng}],{radius:8,color:'#fff',weight:2,fillColor:'${color}',fillOpacity:1}).addTo(map);`;

  const markers: string[] = [];
  if (pickup) markers.push(dot(pickup.lat, pickup.lng, Colors.secondary));
  if (dropoff) markers.push(dot(dropoff.lat, dropoff.lng, Colors.primary));
  if (driver) markers.push(dot(driver.lat, driver.lng, Colors.tertiary));

  // route is [lng,lat] → Leaflet wants [lat,lng]
  const routeLatLng = (route ?? []).map(([lng, lat]) => [lat, lng]);
  const routeJs =
    routeLatLng.length >= 2
      ? `var line=L.polyline(${JSON.stringify(routeLatLng)},{color:'${Colors.primary}',weight:5,opacity:0.85}).addTo(map);bounds.extend(line.getBounds());`
      : pickup && dropoff
        ? // No snapped route: draw a dashed straight connector so the map still
          // shows the pickup → destination relationship.
          `L.polyline([[${pickup.lat},${pickup.lng}],[${dropoff.lat},${dropoff.lng}]],{color:'${Colors.primary}',weight:4,opacity:0.7,dashArray:'6,8'}).addTo(map);`
        : '';

  // Focus: driver > midpoint of pickup/dropoff > whichever exists.
  const focus = driver ?? pickup ?? dropoff ?? { lat: 6.4541, lng: 3.3947 };

  const boundsPts: LatLng[] = [pickup, dropoff, driver].filter(Boolean) as LatLng[];
  const boundsJs = boundsPts
    .map((p) => `bounds.extend([${p.lat},${p.lng}]);`)
    .join('');

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0;padding:0;background:${Colors.surfaceContainer}}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map=L.map('map',{zoomControl:false,attributionControl:true,dragging:true,scrollWheelZoom:false});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  map.setView([${focus.lat},${focus.lng}], 14);
  var bounds=L.latLngBounds([]);
  ${boundsJs}
  ${routeJs}
  ${markers.join('\n  ')}
  if(bounds.isValid()){ map.fitBounds(bounds,{padding:[36,36],maxZoom:16}); }
</script></body></html>`;
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainer },
  web: { flex: 1, backgroundColor: Colors.surfaceContainer },
  grid: { ...StyleSheet.absoluteFillObject },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(11,28,48,0.05)' },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(11,28,48,0.05)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pin: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  pinDotStart: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.secondary, borderWidth: 3, borderColor: Colors.white },
  routeLine: {
    position: 'absolute', top: '32%', left: '28%', width: '46%', height: 3,
    backgroundColor: Colors.secondary, opacity: 0.5, borderRadius: 2,
    transform: [{ rotate: '24deg' }],
  },
  captionWrap: {
    position: 'absolute', bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: Radius.md,
    paddingVertical: 6, paddingHorizontal: Spacing.sm, alignItems: 'center',
  },
  caption: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
