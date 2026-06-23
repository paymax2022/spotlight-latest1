import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import MapView from './MapView';
import { autocomplete, geocode, reverse, type MapSuggestion } from '../api/maps.api';

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
  onConfirmed,
}: AddressEntryProps) {
  const sessionToken = useMemo(makeToken, []);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<MapSuggestion[]>([]);
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
      try {
        const s = await autocomplete(value, { sessionToken, surface, near: pin ?? initialCenter });
        setSuggestions(s);
      } catch {
        setSuggestions([]); // graceful: user can still drop a pin manually
      }
    }, 250);
  };

  // Place/move the pin and refresh Plus Code + label from the OpenStack reverse
  // geocoder (source of truth).
  const placePin = async (lat: number, lng: number) => {
    setPin({ lat, lng });
    setConfirmed(false);
    try {
      const r = await reverse(lat, lng, 'default');
      setPlusCode(r.plus_code);
      if (!label) setLabel(r.address);
    } catch {
      /* keep the pin even if reverse fails — routing works off the pin */
    }
  };

  const selectSuggestion = async (s: MapSuggestion) => {
    setQuery(s.label);
    setLabel(s.label);
    setSuggestions([]);
    setBusy(true);
    try {
      // Resolve an OpenStack pin for the chosen text (never use Google coords on
      // the OSM map). If the OSM geocoder misses, the user drops a pin manually.
      const g = await geocode(s.label, 'default');
      await placePin(g.lat, g.lng);
    } catch {
      /* fall through to manual pin drop */
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
      <View>
        <TextInput
          value={query}
          onChangeText={onType}
          placeholder="Search address, area or landmark…"
          style={styles.input}
          autoCorrect={false}
        />
        {suggestions.length > 0 && (
          <View style={styles.dropdown}>
            {suggestions.map((s, i) => (
              <Pressable
                key={s.place_id || String(i)}
                onPress={() => selectSuggestion(s)}
                style={styles.suggestion}
              >
                <Text numberOfLines={1}>{s.label}</Text>
              </Pressable>
            ))}
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
        {pin && (
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
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, backgroundColor: '#fff' },
  dropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    zIndex: 5,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestion: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f1f5f9' },
  map: { height: 300 },
  info: { fontSize: 13, color: '#374151' },
  button: { padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  confirmPin: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#16a34a', borderWidth: 3, borderColor: '#fff' },
});
