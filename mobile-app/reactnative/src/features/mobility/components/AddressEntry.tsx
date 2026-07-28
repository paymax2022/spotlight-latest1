import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView from './MapView';

// Same lazy-require pattern as MapView.tsx — @maplibre throws at module-init
// time when the native binary is absent (Expo Go / JS-only builds).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapLibreGL: any = null;
if (!!NativeModules.MLRNModule) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    MapLibreGL = require('@maplibre/maplibre-react-native').default;
  } catch {
    // Native module missing — PointAnnotation simply won't render
  }
}
import {
  searchAddress,
  resolveCoordinate,
  reverseLookup,
  type AddressHit,
} from '@/lib/addressLookup';

export interface ConfirmedAddress {
  lat: number;
  lng: number;
  plusCode: string;
  /** The typed/selected text is only a LABEL; the pin + Plus Code is truth. */
  addressLabel: string;
}

export interface AddressEntryProps {
  /** Consumer surface uses Google autocomplete per config. */
  surface?: 'checkout' | 'delivery';
  initialCenter?: { lat: number; lng: number };
  /** Seed the search box (e.g. the currently-set pickup address when editing). */
  initialQuery?: string;
  onConfirmed: (addr: ConfirmedAddress) => void;
}

function makeToken(): string {
  return 'xxxxxxxxyxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * AddressEntry implements the Nigeria address-capture rule on mobile: autocomplete
 * + MANDATORY confirm-on-map pin + Plus Code capture, with a per-session token.
 * Google powers only the TEXT suggestions; the map, pin, and resolved coordinate
 * are OpenStack-sourced, so no Google coordinate is drawn on the OSM basemap. You
 * cannot confirm without a pin.
 */
export default function AddressEntry({
  surface = 'checkout',
  initialCenter = { lat: 6.4541, lng: 3.3947 },
  initialQuery = '',
  onConfirmed,
}: AddressEntryProps) {
  const sessionToken = useMemo(makeToken, []);
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<AddressHit[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [plusCode, setPlusCode] = useState('');
  const [label, setLabel] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
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
      // Unified resolver: backend MapService proxy (Google) with an offline
      // fallback + circuit breaker — the field never goes dead when the proxy
      // is down/misconfigured (searchAddress returns [] instead of throwing).
      const s = await searchAddress(value, { sessionToken, surface, near: pin ?? initialCenter });
      setSuggestions(s);
    }, 250);
  };

  // Place/move the pin and refresh Plus Code + label from the reverse geocoder
  // (proxy 'default' surface; offline fallback keeps the pin usable).
  // `keepLabel` preserves a label the user just chose from a suggestion — the
  // reverse-geocode label must never clobber it (React state is async, so the
  // `label` state var read here is stale on the selectSuggestion path).
  const placePin = async (lat: number, lng: number, opts: { keepLabel?: boolean } = {}) => {
    setPin({ lat, lng });
    setConfirmed(false);
    const r = await reverseLookup(lat, lng); // never throws
    if (r) {
      setPlusCode(r.plusCode ?? '');
      if (!opts.keepLabel) setLabel((prev) => prev || r.label);
    }
    /* keep the pin even if reverse fails — routing works off the pin */
  };

  const selectSuggestion = async (s: AddressHit) => {
    setQuery(s.label);
    setLabel(s.label);
    setSuggestions([]);
    setBusy(true);
    try {
      // Resolve a pin for the chosen text. Google text suggestions carry no
      // coordinate, so this geocodes via the proxy's 'default' (OpenStack)
      // surface — never a Google coord on the OSM map. Offline (mock) hits
      // already carry safe coordinates and pass straight through. If everything
      // misses, the user drops a pin manually.
      const isProxyTextHit = s.source === 'proxy';
      const r = await resolveCoordinate(
        isProxyTextHit ? { ...s, lat: undefined, lng: undefined } : s,
      );
      if (r) await placePin(r.lat, r.lng, { keepLabel: true });
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!pin) return;
    setConfirmed(true);
    onConfirmed({ lat: pin.lat, lng: pin.lng, plusCode: plusCode || '', addressLabel: label || query });
  };

  const center = pin ?? initialCenter;

  return (
    <View style={styles.wrap}>
      {/* zIndex lifts the input+dropdown above the MapView sibling — without it
          the suggestion list paints UNDER the map on web (RNW stacking). */}
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={onType}
          placeholder="Search address, area or landmark…"
          style={styles.input}
          autoCorrect={false}
        />
        {suggestions.length > 0 && (
          <View style={styles.dropdown}>
            {suggestions.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => selectSuggestion(s)}
                style={styles.suggestion}
              >
                <Text numberOfLines={1}>{s.primary}</Text>
                {s.secondary ? (
                  <Text numberOfLines={1} style={styles.suggestionSecondary}>{s.secondary}</Text>
                ) : null}
              </Pressable>
            ))}
            {/* Google requires attribution when Places results aren't shown on a
                Google map (these render on the MapLibre/OSM basemap). */}
            {suggestions.some((s) => s.source === 'proxy') ? (
              <Text style={styles.attribution}>Powered by Google</Text>
            ) : null}
          </View>
        )}
      </View>

      <MapView
        surface="default" // pin always confirmed on the OpenStack basemap
        center={center}
        zoom={pin ? 15 : 12}
        onPress={(lat, lng) => placePin(lat, lng)}
        style={styles.map}
      >
        {pin && MapLibreGL && (
          <MapLibreGL.PointAnnotation
            id="address-pin"
            coordinate={[pin.lng, pin.lat]}
            draggable
            onDragEnd={(e: any) => {
              const c = e?.geometry?.coordinates;
              if (c) placePin(c[1], c[0]);
            }}
          >
            <View style={styles.confirmPin} />
          </MapLibreGL.PointAnnotation>
        )}
      </MapView>

      <Text style={styles.info}>
        {pin
          ? `Pin: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${plusCode ? ` · Plus Code ${plusCode}` : ''}`
          : 'Tap the map (or pick a suggestion) to drop a pin, then drag it to the exact spot.'}
      </Text>

      <Pressable
        onPress={confirm}
        disabled={!pin || busy}
        style={[
          styles.button,
          { backgroundColor: confirmed ? '#15803d' : pin ? '#2563eb' : '#9ca3af' },
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{confirmed ? 'Pin confirmed ✓' : 'Confirm this pin'}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  searchWrap: { position: 'relative', zIndex: 10 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, backgroundColor: '#fff' },
  dropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestion: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f1f5f9' },
  suggestionSecondary: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  attribution: { fontSize: 11, color: '#9ca3af', textAlign: 'right', paddingHorizontal: 10, paddingVertical: 4 },
  map: { height: 300 },
  info: { fontSize: 13, color: '#374151' },
  button: { padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  confirmPin: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#16a34a', borderWidth: 3, borderColor: '#fff' },
});
