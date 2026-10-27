// Proximity control strip for the marketplace discovery screens (Home, Results).
// One component because the two screens must say the same thing in the same words
// about the same number, and because its most important behaviour is a negative:
// with no device fix it makes no distance claim at all.
//
// `available === false` (no expo-location in this build) hides the whole strip —
// showing "Use my location" that can never work is worse than silence.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MapPin, MapPinOff, Navigation } from 'lucide-react-native';
import { Typography, Spacing, Radius } from '@/constants/tokens';
import { MarketColors } from '../constants';
import { RADIUS_CHOICES_KM } from '../proximity';
import type { DeviceCoords } from '@/features/location/useDeviceCoords';

interface Props {
  coords: DeviceCoords | null;
  loading: boolean;
  /** Set only after a failed request — never "we haven't asked yet". */
  error: string | null;
  /** False when this build has no expo-location: no distance can be measured,
   *  so the strip renders nothing rather than a button that can never work. */
  available: boolean;
  onAsk: () => void;
  onClear: () => void;
  /** null = no radius filter is applied. Home always has one (its rail is defined by
   *  it); Results starts at null so turning location on orders the list by distance
   *  instead of hiding every match that is far away. */
  radiusKm: number | null;
  /** Re-tapping the active chip sends null to clear the filter; a screen whose rail
   *  cannot exist without a radius coerces it back in its own handler. */
  onRadius: (km: number | null) => void;
  /** Where the strip sits, for the label wording: Home promises a rail,
   *  Results promises an ordering. */
  surface: 'home' | 'results';
  /** Results only: whether the list really is ordered by distance. The buyer can
   *  pick another sort while keeping location on, and the strip must not then claim
   *  an ordering the list isn't following. */
  sortByDistance?: boolean;
}

export default function ProximityBar({ coords, loading, error, available, onAsk, onClear, radiusKm, onRadius, surface, sortByDistance = true }: Props) {
  if (!available) return null;
  const granted = !!coords;

  // Four honest states on Results: ordered-by-distance or merely measured, times
  // filtered-by-radius or not.
  const resultsLabel = [
    sortByDistance ? 'Sorted by distance from you' : 'Showing how far each item is',
    radiusKm === null ? null : `within ${radiusKm} km`,
  ].filter(Boolean).join(' · ');

  const status = loading
    ? 'Finding you…'
    : granted
      ? surface === 'home'
        ? `Listings within ${radiusKm} km of you`
        : resultsLabel
      : error
        ? error
        : surface === 'home'
          ? 'Turn on location to see what is actually near you'
          : 'Turn on location to sort by distance';

  return (
    <View style={styles.wrap}>
      <View style={styles.statusRow}>
        {granted ? <MapPin size={15} color={MarketColors.brand} /> : <MapPinOff size={15} color={MarketColors.muted} />}
        <Text style={[styles.statusText, granted && styles.statusTextOn]} numberOfLines={2}>{status}</Text>
        {granted ? (
          <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Stop using my location">
            <Text style={styles.clearText}>Off</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={onAsk}
            disabled={loading}
            hitSlop={6}
            style={styles.askBtn}
            accessibilityRole="button"
            accessibilityLabel="Use my current location"
          >
            <Navigation size={12} color="#FFFFFF" />
            <Text style={styles.askBtnText}>{loading ? 'Locating' : 'Use my location'}</Text>
          </Pressable>
        )}
      </View>

      {granted ? (
        <View style={styles.chipRow}>
          {RADIUS_CHOICES_KM.map((km) => (
            <Pressable
              key={km}
              style={[styles.chip, radiusKm === km && styles.chipActive]}
              onPress={() => onRadius(radiusKm === km ? null : km)}
              accessibilityRole="button"
              accessibilityLabel={`Within ${km} kilometres`}
            >
              <Text style={[styles.chipText, radiusKm === km && styles.chipTextActive]}>{km} km</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs, paddingBottom: Spacing.md, gap: Spacing.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { ...Typography.labelSm, color: MarketColors.muted, flex: 1 },
  statusTextOn: { color: MarketColors.text, fontWeight: '600' },
  clearText: { ...Typography.labelSm, color: MarketColors.muted, textDecorationLine: 'underline' },
  askBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: MarketColors.brand, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  askBtnText: { ...Typography.labelSm, color: '#FFFFFF', fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: Spacing.xs },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, backgroundColor: MarketColors.surfaceAlt },
  chipActive: { backgroundColor: MarketColors.brand },
  chipText: { ...Typography.labelSm, color: MarketColors.muted },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
});
