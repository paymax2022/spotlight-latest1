import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import TierBadge from './TierBadge';
import { LoyaltyColors, formatPoints } from '../constants/loyalty.constants';
import type { LoyaltyAccount, Tier } from '../types';

interface Props {
  account: LoyaltyAccount;
  tier: Pick<Tier, 'name' | 'color'>;
  nextTierName?: string | null;
}

export default function PointsBalanceCard({ account, tier, nextTierName }: Props) {
  const total = account.balancePoints + account.pointsToNext;
  const pct = account.pointsToNext > 0
    ? Math.min(100, Math.round((account.lifetimePoints / (account.lifetimePoints + account.pointsToNext)) * 100))
    : 100;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.labelRow}>
          <Sparkles size={16} color={Colors.gold} />
          <Text style={styles.label}>Points balance</Text>
        </View>
        <TierBadge tier={tier} size="sm" />
      </View>

      <Text style={styles.points}>{formatPoints(account.balancePoints)}</Text>
      {/* NL-4: points are non-cash — labelled clearly. */}
      <Text style={styles.nonCash}>Promotional points · not cash</Text>

      {account.nextTierId && account.pointsToNext > 0 ? (
        <View style={styles.progressWrap}>
          <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
          <Text style={styles.progressText}>
            {formatPoints(account.pointsToNext)} to {nextTierName ?? 'next tier'}
          </Text>
        </View>
      ) : (
        <Text style={styles.topTier}>You're at the top tier 🎉</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 4 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...Typography.labelMd, color: Colors.inversePrimary },
  points: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 40, letterSpacing: -0.8, lineHeight: 46 },
  nonCash: { ...Typography.labelSm, color: Colors.inversePrimary },
  progressWrap: { marginTop: Spacing.md, gap: 6 },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: LoyaltyColors.brand },
  progressText: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  topTier: { ...Typography.labelMd, color: Colors.inverseOnSurface, marginTop: Spacing.md },
});
