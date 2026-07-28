import React, { useMemo } from 'react';
import { NativeModules, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import MapView, { type MapMarker } from './MapView';
import MapPlaceholder from './MapPlaceholder';
import type { LatLng } from '../types/mobility.types';

// @maplibre/maplibre-react-native throws at module-init time when its native
// binary is absent (Expo Go / JS-only builds). Mirror the lazy-require guard used
// by LiveTrackingMap/LiveTripMap/MapView so this never crashes before a component
// can render — when the module is missing we fall back to MapPlaceholder.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapLibreGL: any = null;
const MAP_NATIVE_AVAILABLE = !!NativeModules.MLRNModule;
if (MAP_NATIVE_AVAILABLE) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    MapLibreGL = require('@maplibre/maplibre-react-native').default;
  } catch {
    /* native binary absent — placeholder fallback below */
  }
}

export interface MobilityMapProps {
  /** Rider/sender pickup origin. */
  pickup?: LatLng | null;
  /** Destination / drop-off. */
  dropoff?: LatLng | null;
  /** Live driver / courier / operator position (overrides the pickup pin focus). */
  driver?: LatLng | null;
  /** Optional [lng,lat] route to draw between pickup and dropoff (e.g. snapped). */
  route?: [number, number][] | null;
  /** Extra markers (e.g. nearby vehicles). */
  markers?: MapMarker[];
  height?: number;
  /** Whether the placeholder should render its route hint when the map is absent. */
  showRoute?: boolean;
  /** Caption shown on the placeholder fallback. */
  caption?: string;
  style?: ViewStyle;
}

/** Average two LatLngs for an initial map centre. */
function midpoint(a?: LatLng | null, b?: LatLng | null): LatLng | undefined {
  if (a && b) return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  return a ?? b ?? undefined;
}

/**
 * MobilityMap is the shared real-map surface for every ride / parcel / towing /
 * trip screen. It renders a MapLibre map with pickup / drop-off / driver markers
 * and an optional route polyline, reusing the same native-module lazy-guard as
 * LiveTrackingMap so it degrades to the styled MapPlaceholder in Expo Go or any
 * JS-only build instead of crashing.
 */
export default function MobilityMap({
  pickup,
  dropoff,
  driver,
  route,
  markers = [],
  height = 200,
  showRoute = true,
  caption,
  style,
}: MobilityMapProps) {
  const allMarkers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (pickup) m.push({ id: 'pickup', lat: pickup.lat, lng: pickup.lng, title: 'Pickup', color: Colors.secondary });
    if (dropoff) m.push({ id: 'dropoff', lat: dropoff.lat, lng: dropoff.lng, title: 'Drop-off', color: Colors.primary });
    if (driver) m.push({ id: 'driver', lat: driver.lat, lng: driver.lng, title: 'Driver', color: Colors.tertiary });
    return [...m, ...markers];
  }, [pickup, dropoff, driver, markers]);

  // Native module missing (Expo Go / JS-only) → fall back to MapPlaceholder,
  // which now renders a REAL OpenStreetMap (Leaflet-in-WebView) when it has
  // coordinates, so dev builds still show the actual pickup / drop-off / driver
  // and route instead of a decorative grid. Feed it the same geo data as the GL
  // map below.
  if (!MAP_NATIVE_AVAILABLE || !MapLibreGL) {
    return (
      <MapPlaceholder
        height={height}
        showRoute={showRoute}
        caption={caption}
        style={style}
        pickup={pickup}
        dropoff={dropoff}
        driver={driver}
        route={route}
      />
    );
  }

  const center = driver ?? midpoint(pickup, dropoff);

  const routeGeoJSON =
    route && route.length >= 2
      ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route } }
      : null;

  return (
    <View style={[styles.wrap, { height }, style]}>
      <MapView
        surface="default"
        center={center ? { lat: center.lat, lng: center.lng } : undefined}
        zoom={driver ? 15 : 13}
        markers={allMarkers}
        style={styles.map}
      >
        {routeGeoJSON && (
          <MapLibreGL.ShapeSource id="mobility-route" shape={routeGeoJSON}>
            <MapLibreGL.LineLayer
              id="mobility-route-line"
              style={{ lineColor: Colors.primary, lineWidth: 5, lineOpacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapLibreGL.ShapeSource>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainer },
  map: { width: '100%', height: '100%', borderRadius: Radius.lg },
});
