import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Users, Repeat, ChevronRight } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { SavingsColors, formatNaira } from '../constants/savings.constants';
import type { AjoCircle, CircleStatus } from '../types';

const STATUS_META: Record<CircleStatus, { label: string; color: string; bg: string }> = {
  FORMING:   { label: 'Forming',   color: SavingsColors.accent,   bg: SavingsColors.surfaceAlt },
  ACTIVE:    { label: 'Active',    color: SavingsColors.ok,       bg: SavingsColors.okBg },
  COMPLETED: { label: 'Completed', color: SavingsColors.muted,    bg: SavingsColors.surfaceAlt },
};

export default function AjoCircleCard({ circle, onPress }: { circle: AjoCircle; onPress?: () => void }) {
  const meta = STATUS_META[circle.status];
  const defaulted = circle.members.filter((m) => m.status === 'DEFAULTED').length;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.iconBox}>
          <Repeat size={20} color={SavingsColors.brand} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{circle.name}</Text>
          <Text style={styles.sub}>{formatNaira(circle.contributionKobo)} / {circle.frequency}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Users size={14} color={SavingsColors.muted} />
          <Text style={styles.metaText}>{circle.memberCount} members</Text>
        </View>
        {circle.status === 'ACTIVE' ? (
          <Text style={styles.metaText}>Cycle {circle.currentCycle} of {circle.memberCount}</Text>
        ) : null}
        {defaulted > 0 ? (
          <Text style={[styles.metaText, { color: SavingsColors.danger }]}>{defaulted} defaulted</Text>
        ) : null}
        <ChevronRight size={16} color={SavingsColors.muted} style={{ marginLeft: 'auto' }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: SavingsColors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.cardPadding,
    gap: Spacing.md,
    ...shadow1,
  },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: SavingsColors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  name: { ...Typography.titleMd, color: SavingsColors.text },
  sub: { ...Typography.bodySm, color: SavingsColors.muted },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { ...Typography.labelSm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: SavingsColors.muted },
});
