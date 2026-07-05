import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ConnectColors } from '../constants/connect.constants';
import { formatKobo, remainingFraction } from '../constants/format';
import type { TierStatus } from '../types/connect.types';

interface Props {
  tier: TierStatus;
  compact?: boolean;
}

/**
 * Tier + daily limit + remaining allowance.
 * PRD §10 note: every money-moving surface MUST render tier, limit and remaining.
 * This is the shared widget for that requirement.
 */
export default function TierLimitBar({ tier, compact }: Props) {
  const unlimited = tier.dailyLimitKobo == null;
  const frac = remainingFraction(tier.remainingKobo, tier.dailyLimitKobo);
  const low = !unlimited && frac < 0.2;

  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.headerRow}>
        <View style={styles.badge}>
          <ShieldCheck size={14} color={ConnectColors.brand} strokeWidth={2.2} />
          <Text style={styles.badgeText}>{tier.label}</Text>
        </View>
        <Text style={styles.limitText}>
          {unlimited ? 'No daily limit' : `Daily limit ${formatKobo(tier.dailyLimitKobo)}`}
        </Text>
      </View>

      {!unlimited && (
        <>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(frac * 100)}%` },
                low && styles.fillLow,
              ]}
            />
          </View>
          <Text style={[styles.remaining, low && styles.remainingLow]}>
            {formatKobo(tier.remainingKobo)} remaining today
          </Text>
        </>
      )}

      {tier.nextTierUnlocks ? (
        <Text style={styles.upgrade}>Upgrade: {tier.nextTierUnlocks}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: ConnectColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  compact: { padding: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.iconBgPurple,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  badgeText: { ...Typography.labelSm, color: ConnectColors.brand },
  limitText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  track: {
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
    marginTop: Spacing.xs,
  },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: ConnectColors.ok },
  fillLow: { backgroundColor: Colors.error },
  remaining: { ...Typography.labelMd, color: Colors.onSurface },
  remainingLow: { color: Colors.error },
  upgrade: { ...Typography.caption, color: Colors.secondary, marginTop: 2 },
});
