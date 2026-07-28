import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Lock, LockOpen, CircleCheck, Vault as VaultIcon } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { SavingsColors, formatNaira } from '../constants/savings.constants';
import type { Vault, VaultStatus } from '../types';

const STATUS_META: Record<VaultStatus, { label: string; color: string; bg: string }> = {
  OPEN:    { label: 'Open',    color: SavingsColors.accent, bg: SavingsColors.surfaceAlt },
  LOCKED:  { label: 'Locked',  color: SavingsColors.brand,  bg: SavingsColors.surfaceAlt },
  FLEX:    { label: 'Flexible',color: SavingsColors.ok,     bg: SavingsColors.okBg },
  MATURED: { label: 'Matured', color: SavingsColors.ok,     bg: SavingsColors.okBg },
  CLOSED:  { label: 'Closed',  color: SavingsColors.muted,  bg: SavingsColors.surfaceAlt },
};

export default function VaultCard({ vault, onPress }: { vault: Vault; onPress?: () => void }) {
  const meta = STATUS_META[vault.status];
  const pct = vault.targetKobo ? Math.min(100, Math.round((vault.balanceKobo / vault.targetKobo) * 100)) : null;
  const StatusIcon = vault.status === 'LOCKED' ? Lock : vault.status === 'MATURED' ? CircleCheck : LockOpen;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.emojiBox}>
          {vault.emoji ? <Text style={styles.emoji}>{vault.emoji}</Text> : <VaultIcon size={20} color={SavingsColors.brand} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{vault.name}</Text>
          <Text style={styles.balance}>{formatNaira(vault.balanceKobo)}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <StatusIcon size={12} color={meta.color} strokeWidth={2.2} />
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {pct !== null ? (
        <View style={styles.progressWrap}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{pct}% of {formatNaira(vault.targetKobo)}</Text>
        </View>
      ) : null}
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
  emojiBox: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: SavingsColors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  name: { ...Typography.titleMd, color: SavingsColors.text },
  balance: { ...Typography.bodySm, color: SavingsColors.muted },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full,
  },
  badgeText: { ...Typography.labelSm },
  progressWrap: { gap: 6 },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: SavingsColors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: SavingsColors.brand },
  progressLabel: { ...Typography.caption, color: SavingsColors.muted },
});
