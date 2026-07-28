import React, { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, View, ViewStyle } from 'react-native';
import MapView from './MapView';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapLibreGL: any = null;
if (!!NativeModules.MLRNModule) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    MapLibreGL = require('@maplibre/maplibre-react-native').default;
  } catch { /* native binary absent */ }
}
import { matchToRoad, type MapPoint } from '../api/maps.api';

export interface LiveTrackingMapProps {
  /** Raw GPS samples for the rider/provider; append as they arrive. */
  gpsTrace: MapPoint[];
  style?: ViewStyle;
}

/** Decode an OSRM/Google encoded polyline (precision 5) into [lng,lat] pairs. */
function decodePolyline(str: string, precision = 5): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 1;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}

/**
 * LiveTrackingMap renders rider/provider tracking using matchToRoad() output: it
 * snaps the raw GPS trace to roads (OSRM/OpenStack) and draws the smoothed
 * polyline plus a marker at the latest position.
 */
export default function LiveTrackingMap({ gpsTrace, style }: LiveTrackingMapProps) {
  const [coords, setCoords] = useState<[number, number][]>([]);

  useEffect(() => {
    let cancelled = false;
    if (gpsTrace.length < 2) {
      setCoords(gpsTrace.map((p) => [p.lng, p.lat]));
      return;
    }
    (async () => {
      let line: [number, number][] = [];
      try {
        const snapped = await matchToRoad(gpsTrace);
        if (snapped.encoded) line = decodePolyline(snapped.encoded);
        else if (snapped.points) line = snapped.points.map((p) => [p.lng, p.lat]);
      } catch {
        line = gpsTrace.map((p) => [p.lng, p.lat]); // graceful: show raw trace
      }
      if (!cancelled) setCoords(line);
    })();
    return () => {
      cancelled = true;
    };
  }, [gpsTrace]);

  const start = gpsTrace[0];
  const last = coords[coords.length - 1];

  const lineGeoJSON = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: coords },
  };

  return (
    <MapView
      surface="default"
      center={start ? { lat: start.lat, lng: start.lng } : undefined}
      zoom={14}
      style={style}
    >
      {coords.length >= 2 && MapLibreGL && (
        <MapLibreGL.ShapeSource id="live-track" shape={lineGeoJSON}>
          <MapLibreGL.LineLayer
            id="live-track-line"
            style={{ lineColor: '#2563eb', lineWidth: 5, lineOpacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
          />
        </MapLibreGL.ShapeSource>
      )}
      {last && MapLibreGL && (
        <MapLibreGL.PointAnnotation id="live-pos" coordinate={last}>
          <View style={styles.dot} />
        </MapLibreGL.PointAnnotation>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#dc2626', borderWidth: 2, borderColor: '#fff' },
});
