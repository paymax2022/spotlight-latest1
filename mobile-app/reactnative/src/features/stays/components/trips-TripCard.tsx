import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatStayRange, formatGuestSummary, formatNaira, StaysColors } from '../constants/stays.constants';
import type { Trip } from '../trips';

const STATE_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  CONFIRMED: { bg: Colors.iconBgTeal, fg: StaysColors.ok, label: 'Confirmed' },
  COMPLETED: { bg: Colors.iconBgBlue, fg: StaysColors.accent, label: 'Completed' },
  CANCELLED_BY_GUEST: { bg: Colors.iconBgGold, fg: Colors.onWarning, label: 'Cancelled' },
  CANCELLED_BY_HOTEL: { bg: Colors.errorContainer, fg: Colors.error, label: 'Cancelled by hotel' },
  NO_SHOW: { bg: Colors.errorContainer, fg: Colors.error, label: 'No-show' },
};

/** Compact booking row used across the My-bookings tabs (SM2). */
export default function TripCard({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const tone = STATE_TONE[trip.state] ?? STATE_TONE.CONFIRMED;
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <Image source={{ uri: trip.coverUrl }} style={styles.cover} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.badgeText, { color: tone.fg }]}>{tone.label}</Text>
          </View>
          <Text style={styles.ref}>{trip.reference}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>{trip.propertyName}</Text>
        <Text style={styles.line} numberOfLines={1}>{trip.city} · {formatStayRange(trip.checkIn, trip.checkOut)}</Text>
        <Text style={styles.line} numberOfLines={1}>{formatGuestSummary(trip.guests)}</Text>
        <View style={styles.footRow}>
          <Text style={styles.total}>{formatNaira(trip.totalKobo)}</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    overflow: 'hidden',
  },
  cover: { width: 104, height: '100%', backgroundColor: Colors.surfaceContainer },
  body: { flex: 1, padding: Spacing.md, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { ...Typography.caption, fontWeight: '700' as const },
  ref: { ...Typography.caption, color: Colors.onSurfaceVariant },
  name: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  line: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  total: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
});
