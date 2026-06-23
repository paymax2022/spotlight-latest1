import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';

interface Props {
  icon:      LucideIcon;
  label:     string;
  value:     string;
  iconColor?: string;
  bgColor?:   string;
}

// New component: compact metric tile for the doctor dashboard grid. Nothing
// existing renders an icon + label + value summary tile (BalanceCard is a full
// wallet hero, RecentActivityCard is a transaction row), so this is genuinely new.
export default function StatCard({ icon: Icon, label, value, iconColor = Colors.primary, bgColor = Colors.iconBgPurple }: Props) {
  return (
    <View style={[styles.card, shadow1]}>
      <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
        <Icon size={18} color={iconColor} strokeWidth={2} />
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card:    { flex: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  value:   { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  label:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
