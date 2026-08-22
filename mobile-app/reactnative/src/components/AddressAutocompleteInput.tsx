import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  NativeModules,
} from 'react-native';
import { MapPin, Navigation, Crosshair, Clock, Check, Pencil } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import MapView from '@/features/mobility/components/MapView';
import {
  searchAddress,
  resolveCoordinate,
  reverseLookup,
  addressLookupEnabled,
  type AddressHit,
  type ResolvedAddress,
} from '@/lib/addressLookup';
import { useCurrentLocation } from '@/features/location/useCurrentLocation';
import { getRecentAddresses, addRecentAddress, type RecentAddress } from '@/features/location/recentAddresses';
import { shouldShowRecentChips } from '@/features/location/recentAddressChips';

// @maplibre throws at module-init when the native binary is absent (Expo Go /
// JS-only builds). Lazy-require the draggable PointAnnotation the same way
// MapView does, so the picker still renders without it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MapLibreGL: any = null;
if (!!NativeModules.MLRNModule) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    MapLibreGL = require('@maplibre/maplibre-react-native').default;
  } catch {
    /* native module missing — pin simply won't render; coordinate still captured */
  }
}

export interface SelectedAddress {
  label: string;
  lat: number;
  lng: number;
  /** Open location code, when the provider resolved one (delivery accuracy). */
  plusCode?: string;
  /** Which stack answered ('proxy' | 'mock'). */
  source?: string;
  /** True when the coordinate came from a confirmed map pin / GPS reverse. */
  precise?: boolean;
}

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  /** Fired when a place is chosen/confirmed — carries the geocoded coordinate. */
  onSelect: (addr: SelectedAddress) => void;
  /** Bias suggestions toward this point (e.g. the restaurant / pickup point). */
  near?: { lat: number; lng: number };
  placeholder?: string;
  /** True once a place has been picked (drives the ✓ confirmation hint). */
  resolved?: boolean;
  /** Consumer surface drives proxy provider routing. */
  surface?: 'checkout' | 'delivery';
  /** Show the inline confirm-on-map pin (default true). */
  enableMapConfirm?: boolean;
  /** Show the "use my current location" action (default true). */
  enableCurrentLocation?: boolean;
  /**
   * Offer previously used addresses (default true) — as a standing row of chips
   * under the field, and in the dropdown when the field is focused & empty.
   */
  enableRecents?: boolean;
}

/**
 * Best-experience delivery/pickup address capture.
 *
 *  • Suggestions — backend MapService proxy (Google autocomplete + Plus Code),
 *    with an offline fallback so the field never goes dead in dev.
 *  • "Use my current location" — GPS → reverse-geocoded address in one tap.
 *  • Recent addresses — one-tap reuse of places ordered to before.
 *  • Confirm-on-map — a draggable pin so the courier gets the EXACT spot, not
 *    just a rooftop centroid (critical where street addresses are unreliable).
 *
 * Degrades cleanly: no providers → plain text field; no GPS module → button
 * hidden; no native map → coordinate still captured from the suggestion/GPS.
 */
export default function AddressAutocompleteInput({
  value,
  onChangeText,
  onSelect,
  near,
  placeholder = 'Enter your delivery address',
  resolved = false,
  surface = 'checkout',
  enableMapConfirm = true,
  enableCurrentLocation = true,
  enableRecents = true,
}: Props) {
  const [suggestions, setSuggestions] = useState<AddressHit[]>([]);
  const [recents, setRecents] = useState<RecentAddress[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

  // The confirmed coordinate + Plus Code for the current selection.
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [plusCode, setPlusCode] = useState<string>('');
  const [mapOpen, setMapOpen] = useState(false);

  const sessionToken = useMemo(
    () => (typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : String(Date.now())),
    [],
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const gps = useCurrentLocation();

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Load recent addresses once (when the feature is on).
  useEffect(() => {
    if (enableRecents) getRecentAddresses().then(setRecents).catch(() => setRecents([]));
  }, [enableRecents]);

  const closeDropdown = () => {
    setSuggestions([]);
    setOpen(false);
    setLoading(false);
  };

  /** Apply a fully-resolved address: update field + pin + notify parent + remember. */
  const applyResolved = useCallback(
    (r: ResolvedAddress, { openMap }: { openMap?: boolean } = {}) => {
      onChangeText(r.label);
      setPin({ lat: r.lat, lng: r.lng });
      setPlusCode(r.plusCode ?? '');
      onSelect({ label: r.label, lat: r.lat, lng: r.lng, plusCode: r.plusCode, source: r.source, precise: r.precise });
      void addRecentAddress(r).then(() => getRecentAddresses().then(setRecents).catch(() => {}));
      closeDropdown();
      if (enableMapConfirm && openMap && MapLibreGL) setMapOpen(true);
    },
    [onChangeText, onSelect, enableMapConfirm],
  );

  const handleChange = (text: string) => {
    onChangeText(text);
    // Typed text invalidates a previously confirmed pin.
    setPin(null);
    setPlusCode('');
    setMapOpen(false);

    if (!addressLookupEnabled()) return; // plain text field fallback

    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (text.trim().length < 3) {
      setSuggestions([]);
      setOpen(focused && enableRecents && recents.length > 0); // keep recents visible
      setLoading(false);
      return;
    }

    setLoading(true);
    setOpen(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const hits = await searchAddress(text, { near, surface, sessionToken, signal: controller.signal });
        setSuggestions(hits);
        setOpen(hits.length > 0 || (enableRecents && recents.length > 0));
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const pickSuggestion = async (hit: AddressHit) => {
    setResolving(true);
    closeDropdown();
    try {
      const r = await resolveCoordinate(hit, { surface });
      if (r) {
        applyResolved(r, { openMap: true });
      } else {
        // Couldn't geocode — keep the text, let the user drop a pin manually.
        onChangeText(hit.label);
        if (enableMapConfirm && MapLibreGL) setMapOpen(true);
      }
    } finally {
      setResolving(false);
    }
  };

  const pickRecent = (r: RecentAddress) => {
    applyResolved({ label: r.label, lat: r.lat, lng: r.lng, plusCode: r.plusCode, source: 'proxy', precise: true });
  };

  const useMyLocation = async () => {
    closeDropdown();
    const r = await gps.getCurrent();
    if (r) applyResolved(r, { openMap: true });
  };

  // Drop / drag the confirm pin → re-resolve address + Plus Code from the coord.
  const movePin = async (lat: number, lng: number) => {
    setPin({ lat, lng });
    setResolving(true);
    try {
      const r = await reverseLookup(lat, lng);
      if (r) {
        setPlusCode(r.plusCode ?? '');
        onChangeText(r.label);
        onSelect({ label: r.label, lat: r.lat, lng: r.lng, plusCode: r.plusCode, source: r.source, precise: true });
      } else {
        onSelect({ label: value, lat, lng, precise: true });
      }
    } finally {
      setResolving(false);
    }
  };

  const showRecents = enableRecents && focused && value.trim().length < 3 && recents.length > 0;
  const dropdownVisible = open && (suggestions.length > 0 || showRecents);

  // Saved addresses as a standing row of chips, not only as a dropdown the user
  // has to know to summon by focusing an empty field. See recentAddressChips.ts
  // for why each condition is there.
  const showRecentChips = shouldShowRecentChips({
    enabled: enableRecents,
    count: recents.length,
    hasPin: Boolean(pin),
    resolved,
    dropdownVisible,
  });
  const mapCenter = pin ?? near ?? { lat: 6.4541, lng: 3.3947 }; // Lagos default

  return (
    <View style={styles.wrap}>
      <View style={[styles.box, shadow1, resolved && styles.boxResolved]}>
        <MapPin size={18} color={resolved ? Colors.primary : Colors.secondary} strokeWidth={2} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={handleChange}
          onFocus={() => {
            setFocused(true);
            if (value.trim().length < 3 && enableRecents && recents.length > 0) setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={Colors.outline}
          autoCorrect={false}
          multiline
        />
        {loading || resolving ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
      </View>

      {dropdownVisible && (
        <View style={[styles.dropdown, shadow1]}>
          {enableCurrentLocation && gps.available && (
            <Pressable onPress={useMyLocation} style={[styles.row, styles.actionRow]} accessibilityRole="button">
              <Crosshair size={16} color={Colors.primary} strokeWidth={2} />
              <View style={styles.rowText}>
                <Text style={styles.actionPrimary}>Use my current location</Text>
                {gps.loading ? <Text style={styles.rowSecondary}>Locating…</Text> : null}
              </View>
              {gps.loading ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
            </Pressable>
          )}

          {showRecents &&
            recents.map((r) => (
              <Pressable key={`r:${r.lat},${r.lng}`} onPress={() => pickRecent(r)} style={styles.row} accessibilityRole="button">
                <Clock size={15} color={Colors.outline} strokeWidth={2} />
                <View style={styles.rowText}>
                  <Text style={styles.rowPrimary} numberOfLines={1}>{r.label.split(',')[0]}</Text>
                  <Text style={styles.rowSecondary} numberOfLines={1}>{r.label}</Text>
                </View>
              </Pressable>
            ))}

          {suggestions.map((s) => (
            <Pressable key={s.id} onPress={() => pickSuggestion(s)} style={styles.row} accessibilityRole="button">
              <Navigation size={15} color={Colors.outline} strokeWidth={2} />
              <View style={styles.rowText}>
                <Text style={styles.rowPrimary} numberOfLines={1}>{s.primary}</Text>
                {s.secondary ? <Text style={styles.rowSecondary} numberOfLines={1}>{s.secondary}</Text> : null}
              </View>
            </Pressable>
          ))}

          {gps.error ? <Text style={styles.errorHint}>{gps.error}</Text> : null}

          {/* Google requires attribution when Places results aren't shown on a
              Google map (these render on the MapLibre basemap). */}
          {suggestions.some((s) => s.source === 'proxy') ? (
            <Text style={styles.attribution}>Powered by Google</Text>
          ) : null}
        </View>
      )}

      {showRecentChips && (
        <View style={styles.recentBar}>
          <View style={styles.recentHead}>
            <Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.recentHeadText}>Recent addresses</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.recentChips}
          >
            {recents.map((r) => (
              <Pressable
                key={`chip:${r.lat},${r.lng}`}
                onPress={() => pickRecent(r)}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                accessibilityRole="button"
                // The chip shows only the first segment to stay compact, so the
                // full address goes to the accessibility label.
                accessibilityLabel={`Use recent address ${r.label}`}
              >
                <Text style={styles.chipText} numberOfLines={1}>
                  {r.label.split(',')[0]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Pin summary + "confirm on map" affordance once a place is chosen. */}
      {pin && enableMapConfirm && !dropdownVisible && (
        <Pressable style={styles.pinSummary} onPress={() => MapLibreGL && setMapOpen((o) => !o)} accessibilityRole="button">
          <Check size={14} color={Colors.tertiaryContainer} strokeWidth={2.5} />
          <Text style={styles.pinSummaryText} numberOfLines={1}>
            Pin set{plusCode ? ` · ${plusCode}` : ''}
          </Text>
          {MapLibreGL ? (
            <View style={styles.adjust}>
              <Pencil size={13} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.adjustText}>{mapOpen ? 'Hide map' : 'Adjust on map'}</Text>
            </View>
          ) : null}
        </Pressable>
      )}

      {mapOpen && enableMapConfirm && (
        <View style={styles.mapWrap}>
          <MapView
            surface="default"
            center={mapCenter}
            zoom={pin ? 16 : 13}
            onPress={(lat, lng) => void movePin(lat, lng)}
            style={styles.map}
          >
            {pin && MapLibreGL && (
              <MapLibreGL.PointAnnotation
                id="address-confirm-pin"
                coordinate={[pin.lng, pin.lat]}
                draggable
                onDragEnd={(e: { geometry?: { coordinates?: [number, number] } }) => {
                  const c = e?.geometry?.coordinates;
                  if (c) void movePin(c[1], c[0]);
                }}
              >
                <View style={styles.confirmPin} />
              </MapLibreGL.PointAnnotation>
            )}
          </MapView>
          <Text style={styles.mapHint}>Drag the pin or tap the map to set the exact spot.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 10 },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  boxResolved: { borderColor: Colors.primary },
  input: {
    ...Typography.bodyMd,
    flex: 1,
    color: Colors.onSurface,
    minHeight: 40,
    paddingTop: Platform.OS === 'ios' ? 2 : 0,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
    zIndex: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  actionRow: { backgroundColor: Colors.surfaceContainerLow },
  rowText: { flex: 1 },
  rowPrimary: { ...Typography.bodyMd, color: Colors.onSurface },
  rowSecondary: { ...Typography.caption, color: Colors.onSurfaceVariant },
  actionPrimary: { ...Typography.labelMd, color: Colors.primary },
  errorHint: { ...Typography.caption, color: Colors.error, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  recentBar: { marginTop: Spacing.sm, gap: 6 },
  recentHead: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.xs },
  recentHeadText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  // paddingRight so the last chip clears the edge when the row scrolls.
  recentChips: { gap: Spacing.xs, paddingHorizontal: Spacing.xs, paddingRight: Spacing.md },
  chip: {
    maxWidth: 200,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
  },
  chipPressed: { opacity: 0.7 },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  pinSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 6,
    paddingHorizontal: Spacing.xs,
  },
  pinSummaryText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  adjust: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  adjustText: { ...Typography.labelSm, color: Colors.primary },
  mapWrap: { marginTop: Spacing.sm, gap: 4 },
  map: { height: 220, borderRadius: Radius.lg, overflow: 'hidden' },
  mapHint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  attribution: { ...Typography.caption, color: Colors.outline, textAlign: 'right', paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  confirmPin: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#16a34a', borderWidth: 3, borderColor: '#fff' },
});
