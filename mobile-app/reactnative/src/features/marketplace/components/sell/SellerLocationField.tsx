// Seller-side half of proximity: the listing's coordinates come from the seller's
// own device at posting time, which is the only position the buyer can measure
// against. Optional by design — a listing with no location still sells, it just
// never appears in a "Near you" rail or a distance sort (see the backend's
// NULLS LAST ordering), so the field offers no default and never blocks Next.
//
// Wording stays on what buyers see rather than the raw numbers: publishing a
// lat/lng pair is a sharing decision, and "6.5244, 3.3792" communicates less
// about it than "buyers will see 3.6 km away".
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MapPin, Navigation } from 'lucide-react-native';
import { Typography, Spacing, Radius } from '@/constants/tokens';
import { MarketColors } from '../../constants';
import type { DeviceCoords } from '@/features/location/useDeviceCoords';

interface Props {
  coords: DeviceCoords | null;
  loading: boolean;
  error: string | null;
  /** False with no expo-location in this build: nothing to record, so nothing to show. */
  available: boolean;
  onAsk: () => void;
  onClear: () => void;
}

export default function SellerLocationField({ coords, loading, error, available, onAsk, onClear }: Props) {
  if (!available) return null;
  const granted = !!coords;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <MapPin size={16} color={granted ? MarketColors.brand : MarketColors.muted} />
        <Text style={styles.title}>Show buyers how far you are</Text>
      </View>
      <Text style={styles.body}>
        We use your current location so buyers can filter and sort by distance — they see a figure like
        “3.6 km away”, never your address.
      </Text>

      {granted ? (
        <>
          <View style={styles.okRow}>
            <Text style={styles.okText} numberOfLines={2}>
              Location attached. Buyers near you will see the distance on your listing.
            </Text>
            <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove my location from this listing">
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          {loading || error ? (
            <Text style={[styles.statusText, !!error && styles.statusTextError]} numberOfLines={2}>
              {loading ? 'Finding you…' : error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onAsk}
              disabled={loading}
              style={styles.askBtn}
              accessibilityRole="button"
              accessibilityLabel={loading ? 'Finding your location' : 'Use my current location'}
            >
              <Navigation size={13} color="#FFFFFF" />
              <Text style={styles.askBtnText}>{loading ? 'Locating…' : error ? 'Try again' : 'Use my location'}</Text>
            </Pressable>
            <Text style={styles.skip}>Optional — you can post without it.</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  body: { ...Typography.labelSm, color: MarketColors.muted },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
  okText: { ...Typography.labelSm, color: MarketColors.ok, fontWeight: '600', flex: 1 },
  removeText: { ...Typography.labelSm, color: MarketColors.muted, textDecorationLine: 'underline' },
  statusText: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 4 },
  statusTextError: { color: MarketColors.warnText },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 6 },
  askBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: MarketColors.brand, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  askBtnText: { ...Typography.labelSm, color: '#FFFFFF', fontWeight: '700' },
  skip: { ...Typography.labelSm, color: MarketColors.muted, flex: 1 },
});
