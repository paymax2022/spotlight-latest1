import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ban } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

/** Sold-out chip — used on cards and (red) map pins, mirroring Booking.com. */
export default function SoldOutBadge({ compact }: { compact?: boolean }) {
  return (
    <View style={[styles.chip, compact && styles.compact]}>
      <Ban size={compact ? 11 : 13} color={Colors.white} strokeWidth={2.4} />
      <Text style={[styles.text, compact && styles.textCompact]}>Sold out</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.error,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  compact: { paddingHorizontal: 8, paddingVertical: 3 },
  text: { ...Typography.labelSm, color: Colors.white, fontWeight: '700' as const },
  textCompact: { ...Typography.caption, color: Colors.white, fontWeight: '700' as const },
});
