import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { STOCK_LEVEL_LABELS } from '@/features/doctor/constants';
import type { StockLevel } from '@/types/doctor.batch3';

interface Props {
  level: StockLevel;
}

// New component: a stock-level pill (in/low/out of stock) for the drug-stock
// availability list. StatusBadge takes a free string tone; this maps the
// StockLevel union to the contract's STOCK_LEVEL_LABELS tones in one place.
const TONE: Record<string, { fg: string; bg: string }> = {
  success: { fg: Colors.teal,      bg: Colors.iconBgTeal },
  warning: { fg: Colors.secondary, bg: Colors.iconBgBlue },
  danger:  { fg: Colors.error,     bg: Colors.errorContainer },
};

export default function StockBadge({ level }: Props) {
  const cfg = STOCK_LEVEL_LABELS[level];
  const c = TONE[cfg.tone] ?? TONE.warning;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.label, { color: c.fg }]} numberOfLines={1}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { height: 24, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelSm, fontWeight: '700' },
});
