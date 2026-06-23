import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import MapView from './MapView';
import { useTripTracking } from '../hooks/useTripTracking';

export interface LiveTripMapProps {
  /** The trip to follow in real time. */
  tripId: string;
  style?: ViewStyle;
}

/** Decode an OSRM/Google encoded polyline (precision 5) into [lng,lat] pairs. */
function decodePolyline(str: string, precision = 5): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const out: [number, number][] = [];
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
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/**
 * LiveTripMap follows a trip in real time over the backend WebSocket. The driver
 * app streams GPS (POST .../trips/:id/track); the backend snaps it via OSRM and
 * pushes positions here. This is the production live-tracking surface (vs.
 * LiveTrackingMap, which renders a static/replay trace).
 */
export default function LiveTripMap({ tripId, style }: LiveTripMapProps) {
  const { position, connected } = useTripTracking(tripId);

  const coords = position?.snappedPolyline ? decodePolyline(position.snappedPolyline) : [];
  const last: [number, number] | undefined = position ? [position.lng, position.lat] : undefined;
  const center = position ? { lat: position.lat, lng: position.lng } : undefined;

  return (
    <MapView surface="default" center={center} zoom={15} style={style}>
      {coords.length >= 2 && (
        <MapLibreGL.ShapeSource
          id="trip-track"
          shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }}
        >
          <MapLibreGL.LineLayer
            id="trip-track-line"
            style={{ lineColor: '#2563eb', lineWidth: 5, lineOpacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
          />
        </MapLibreGL.ShapeSource>
      )}
      {last && (
        <MapLibreGL.PointAnnotation id="trip-pos" coordinate={last}>
          <View style={[styles.dot, { backgroundColor: connected ? '#16a34a' : '#9ca3af' }]} />
        </MapLibreGL.PointAnnotation>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#fff' },
});
