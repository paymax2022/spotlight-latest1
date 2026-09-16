'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapsClient, type MapSource, type MapStyleConfig } from '@/services/mapsClient';

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  /** Licensing stack of the coordinate. A 'google' marker is REFUSED on an
   *  OpenStack basemap (client mirror of the server license-coherence guard). */
  source?: MapSource;
}

export interface MapViewProps {
  surface?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  /** Called once the map is ready, with the map + maplibregl module, so callers
   *  (e.g. AddressEntry) can attach their own draggable pin. */
  onReady?: (map: maplibregl.Map, gl: typeof maplibregl, basemapSource: MapSource) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * MapView is the MapLibre GL renderer, fed by getBasemapConfig() (style URL +
 * attribution). It never talks to a provider directly and enforces license
 * coherence: a Google-sourced marker is not drawn on the OpenStack basemap.
 */
export default function MapView({
  surface = 'default',
  center = { lat: 6.4541, lng: 3.3947 }, // Lagos
  zoom = 12,
  markers = [],
  onReady,
  className,
  style,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<maplibregl.Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [basemapSource, setBasemapSource] = useState<MapSource>('openstack');

  // Init map from the backend basemap config.
  useEffect(() => {
    let cancelled = false;
    let cfg: MapStyleConfig;

    (async () => {
      try {
        cfg = await mapsClient.getBasemap(surface);
      } catch (e) {
        if (!cancelled) setError('Could not load basemap');
        return;
      }
      if (cancelled || !containerRef.current) return;
      setBasemapSource(cfg.source);

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: cfg.style_url,
        center: [center.lng, center.lat],
        zoom,
        attributionControl: false,
      });
      map.addControl(new maplibregl.AttributionControl({ customAttribution: cfg.attribution }));
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current = map;
      map.on('load', () => onReady?.(map, maplibregl, cfg.source));
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  // Sync markers, enforcing license coherence.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerObjs.current.forEach((m) => m.remove());
    markerObjs.current = [];

    for (const mk of markers) {
      if (basemapSource === 'openstack' && mk.source === 'google') {
        // License coherence: never render a Google-sourced point on OSM tiles.
        // eslint-disable-next-line no-console
        console.error('MapView: refusing to render a Google-sourced marker on the OpenStack basemap', mk);
        continue;
      }
      const marker = new maplibregl.Marker({ color: mk.color || '#2563eb' })
        .setLngLat([mk.lng, mk.lat])
        .addTo(map);
      if (mk.label) marker.setPopup(new maplibregl.Popup({ offset: 24 }).setText(mk.label));
      markerObjs.current.push(marker);
    }
  }, [markers, basemapSource]);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: 360, ...style }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, borderRadius: 8 }} />
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#b91c1c' }}>
          {error}
        </div>
      )}
    </div>
  );
}
