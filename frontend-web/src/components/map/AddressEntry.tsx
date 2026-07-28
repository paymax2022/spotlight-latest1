'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import MapView from './MapView';
import { mapsClient, type MapSuggestion } from '@/services/mapsClient';

export interface ConfirmedAddress {
  lat: number;
  lng: number;
  plusCode: string;
  /** Typed/selected text is only a LABEL; the pin + Plus Code is the source of truth. */
  addressLabel: string;
}

export interface AddressEntryProps {
  /** Consumer surface uses Google autocomplete per config ('checkout'|'delivery'). */
  surface?: 'checkout' | 'delivery';
  initialCenter?: { lat: number; lng: number };
  onConfirmed: (addr: ConfirmedAddress) => void;
}

/**
 * AddressEntry implements the Nigeria address-capture rule: autocomplete +
 * MANDATORY confirm-on-map pin + Plus Code capture, with a per-session token.
 *
 * Coherence note: Google only powers the TEXT suggestions. The map, the pin, and
 * the resolved coordinate are OpenStack-sourced — so no Google coordinate is ever
 * drawn on the OSM basemap. You cannot submit without a confirmed pin.
 */
export default function AddressEntry({
  surface = 'checkout',
  initialCenter = { lat: 6.4541, lng: 3.3947 },
  onConfirmed,
}: AddressEntryProps) {
  const sessionToken = useMemo(
    () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    [],
  );

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<MapSuggestion[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [plusCode, setPlusCode] = useState('');
  const [label, setLabel] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const glRef = useRef<typeof maplibregl | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onType = (value: string) => {
    setQuery(value);
    setConfirmed(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const s = await mapsClient.autocomplete(value, { sessionToken, surface, near: pin ?? initialCenter });
        setSuggestions(s);
      } catch {
        setSuggestions([]); // graceful: user can still drop a pin manually
      }
    }, 250);
  };

  // Place / move the draggable pin and refresh the Plus Code + label from the
  // OpenStack reverse geocoder (source of truth).
  const placePin = useCallback(async (lat: number, lng: number) => {
    const gl = glRef.current;
    const map = mapRef.current;
    if (gl && map) {
      if (!markerRef.current) {
        markerRef.current = new gl.Marker({ draggable: true, color: '#16a34a' }).setLngLat([lng, lat]).addTo(map);
        markerRef.current.on('dragend', () => {
          const ll = markerRef.current!.getLngLat();
          void placePin(ll.lat, ll.lng);
        });
      } else {
        markerRef.current.setLngLat([lng, lat]);
      }
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15) });
    }
    setPin({ lat, lng });
    setConfirmed(false);
    try {
      const r = await mapsClient.reverse(lat, lng, 'default'); // OpenStack
      setPlusCode(r.plus_code);
      if (!label) setLabel(r.address);
    } catch {
      /* keep pin even if reverse fails — routing works off the pin */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  const selectSuggestion = async (s: MapSuggestion) => {
    setQuery(s.label);
    setLabel(s.label);
    setSuggestions([]);
    setBusy(true);
    try {
      // Resolve an OpenStack pin for the chosen text (never use Google coords on
      // the OSM map). If the OSM geocoder misses, the user drops the pin manually.
      const g = await mapsClient.geocode(s.label, 'default');
      await placePin(g.lat, g.lng);
    } catch {
      /* fall through to manual pin drop */
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!pin) return;
    const code = plusCode || '';
    setConfirmed(true);
    onConfirmed({ lat: pin.lat, lng: pin.lng, plusCode: code, addressLabel: label || query });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={(e) => onType(e.target.value)}
          placeholder="Search address, area or landmark…"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8 }}
        />
        {suggestions.length > 0 && (
          <ul
            style={{
              position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, margin: 0, padding: 0,
              listStyle: 'none', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 220, overflow: 'auto',
            }}
          >
            {suggestions.map((s, i) => (
              <li key={s.place_id || i}>
                <button
                  type="button"
                  onClick={() => selectSuggestion(s)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MapView
        surface="default" // pin always confirmed on the OpenStack basemap
        center={pin ?? initialCenter}
        onReady={(map, gl) => {
          mapRef.current = map;
          glRef.current = gl;
          map.on('click', (e) => void placePin(e.lngLat.lat, e.lngLat.lng));
        }}
        style={{ height: 320 }}
      />

      <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>
        {pin
          ? `Pin: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${plusCode ? ` · Plus Code ${plusCode}` : ''}`
          : 'Tap the map (or pick a suggestion) to drop a pin, then drag it to the exact spot.'}
      </p>

      <button
        type="button"
        onClick={confirm}
        disabled={!pin || busy}
        style={{
          padding: '10px 14px', borderRadius: 8, border: 'none', cursor: pin ? 'pointer' : 'not-allowed',
          background: confirmed ? '#15803d' : pin ? '#2563eb' : '#9ca3af', color: '#fff', fontWeight: 600,
        }}
      >
        {confirmed ? 'Pin confirmed ✓' : 'Confirm this pin'}
      </button>
    </div>
  );
}
