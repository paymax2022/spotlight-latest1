'use client';

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import MapView from './MapView';
import { mapsClient, type MapPoint } from '@/services/mapsClient';

export interface LiveTrackingMapProps {
  /** Raw GPS samples for the rider/provider; append to this as they arrive. */
  gpsTrace: MapPoint[];
  className?: string;
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

const SRC = 'live-track';
const LAYER = 'live-track-line';

/**
 * LiveTrackingMap renders rider/provider tracking using matchToRoad() output: it
 * snaps the raw GPS trace to roads (OSRM/OpenStack) and draws the smoothed
 * polyline plus a marker at the latest position.
 */
export default function LiveTrackingMap({ gpsTrace, className }: LiveTrackingMapProps) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const glRef = useRef<typeof maplibregl | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (!map || !gl || gpsTrace.length < 2) return;
    let cancelled = false;

    (async () => {
      let coords: [number, number][] = [];
      try {
        const snapped = await mapsClient.matchToRoad(gpsTrace);
        if (snapped.encoded) coords = decodePolyline(snapped.encoded);
        else if (snapped.points) coords = snapped.points.map((p) => [p.lng, p.lat]);
      } catch {
        coords = gpsTrace.map((p) => [p.lng, p.lat]); // graceful: show raw trace
      }
      if (cancelled || coords.length === 0) return;

      const geojson = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: coords },
      };
      const existing = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(geojson);
      } else {
        map.addSource(SRC, { type: 'geojson', data: geojson });
        map.addLayer({
          id: LAYER,
          type: 'line',
          source: SRC,
          paint: { 'line-color': '#2563eb', 'line-width': 5, 'line-opacity': 0.85 },
        });
      }

      const last = coords[coords.length - 1];
      if (!markerRef.current) {
        markerRef.current = new gl.Marker({ color: '#dc2626' }).setLngLat(last).addTo(map);
      } else {
        markerRef.current.setLngLat(last);
      }
      map.easeTo({ center: last, duration: 500 });
    })();

    return () => {
      cancelled = true;
    };
  }, [gpsTrace]);

  const start = gpsTrace[0];
  return (
    <MapView
      className={className}
      surface="default"
      center={start ? { lat: start.lat, lng: start.lng } : undefined}
      zoom={14}
      onReady={(map, gl) => {
        mapRef.current = map;
        glRef.current = gl;
      }}
    />
  );
}
