import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNairaCompact } from '../utils/crowdfundingFormatters';
import type { CreatorStats } from '../types/crowdfunding.types';

interface Props {
  stats?: CreatorStats;
  isLoading?: boolean;
  onStart: () => void;
}

/**
 * Header banner for the creator's campaign list.
 *
 * Shows the creator's REAL totals from useCreatorStats rather than decoration.
 * A banner carrying invented numbers would be worse than none: this screen is
 * where someone checks how their fundraising is doing, and a plausible fake is
 * exactly the sort of thing nobody goes looking for a bug in.
 *
 * While the figures load it renders a spinner in their place instead of zeroes —
 * "₦0 raised" is a statement, and it must not be made before it is known.
 */
export default function CreatorCampaignsBanner({ stats, isLoading, onStart }: Props) {
  return (
    <LinearGradient
      colors={[Colors.primary, Colors.onPrimaryFixedVariant]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.banner}
    >
      <View style={styles.top}>
        <View style={styles.iconWrap}>
          <TrendingUp size={16} color={Colors.onPrimary} strokeWidth={2.2} />
        </View>
        <Text style={styles.eyebrow}>Your fundraising</Text>
      </View>

      {isLoading || !stats ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.onPrimary} />
        </View>
      ) : (
        <>
          <Text style={styles.amount} accessibilityRole="header">
            {formatNairaCompact(stats.totalRaisedKobo)}
          </Text>
          <Text style={styles.amountLabel}>raised across all campaigns</Text>

          <View style={styles.statRow}>
            <Stat value={String(stats.activeCampaigns)} label={stats.activeCampaigns === 1 ? 'Active' : 'Active'} />
            <View style={styles.divider} />
            <Stat value={stats.contributorCount.toLocaleString('en-NG')} label="Backers" />
            <View style={styles.divider} />
            <Stat value={formatNairaCompact(stats.availableBalanceKobo)} label="Available" />
          </View>
        </>
      )}

      <Pressable
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
        onPress={onStart}
        accessibilityRole="button"
        accessibilityLabel="Start a new campaign"
      >
        <Plus size={16} color={Colors.primary} strokeWidth={2.4} />
        <Text style={styles.ctaText}>Start a campaign</Text>
      </Pressable>
    </LinearGradient>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  iconWrap: {
    width: 26, height: 26, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  eyebrow: { ...Typography.labelSm, color: 'rgba(255,255,255,0.85)' },
  loading: { height: 78, alignItems: 'center', justifyContent: 'center' },
  amount: { ...Typography.headlineLg, color: Colors.onPrimary, marginTop: 2 },
  amountLabel: { ...Typography.labelSm, color: 'rgba(255,255,255,0.75)' },
  statRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: Spacing.sm, paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.22)',
  },
  stat: { flex: 1, gap: 1 },
  statValue: { ...Typography.labelLg, color: Colors.onPrimary },
  statLabel: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  divider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(255,255,255,0.22)' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 42, borderRadius: Radius.full, backgroundColor: Colors.onPrimary,
    marginTop: Spacing.sm,
  },
  ctaText: { ...Typography.labelLg, color: Colors.primary },
});
