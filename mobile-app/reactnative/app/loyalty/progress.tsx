import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Crown, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useLoyaltyAccount, useTiers } from '@/features/loyalty/hooks';
import { LoyaltyColors, formatPoints } from '@/features/loyalty/constants/loyalty.constants';

export default function Progress() {
  const account = useLoyaltyAccount();
  const tiers = useTiers();

  const loading = account.isLoading || tiers.isLoading;
  const errored = account.isError || tiers.isError;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your progress" />
      {loading ? (
        <StateView kind="loading" message="Loading progress…" />
      ) : errored || !account.data || !tiers.data ? (
        <StateView kind="error" title="Couldn't load progress" message="Please try again." actionLabel="Retry" onAction={() => { account.refetch(); tiers.refetch(); }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {(() => {
            const acc = account.data!;
            const next = tiers.data!.find((t) => t.id === acc.nextTierId);
            const current = tiers.data!.find((t) => t.id === acc.tierId)!;
            const span = next ? next.minPoints - current.minPoints : 1;
            const into = acc.lifetimePoints - current.minPoints;
            const pct = next ? Math.min(100, Math.round((into / span) * 100)) : 100;
            return (
              <>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Crown size={20} color={current.color} />
                    <Text style={styles.cardTitle}>{current.name}</Text>
                    {next ? <Text style={styles.nextLabel}>→ {next.name}</Text> : <Text style={styles.nextLabel}>Top tier</Text>}
                  </View>
                  <View style={styles.bigTrack}><View style={[styles.bigFill, { width: `${pct}%`, backgroundColor: current.color }]} /></View>
                  <Text style={styles.pctText}>{pct}% there</Text>
                  {next ? (
                    <Text style={styles.toNext}>{formatPoints(acc.pointsToNext)} more lifetime points to reach {next.name}</Text>
                  ) : (
                    <Text style={styles.toNext}>You've reached the highest tier. Keep earning to redeem more rewards.</Text>
                  )}
                </View>

                <View style={styles.statsRow}>
                  <Stat label="Lifetime points" value={formatPoints(acc.lifetimePoints)} />
                  <Stat label="Spendable now" value={formatPoints(acc.balancePoints)} />
                </View>

                <View style={styles.tip}>
                  <TrendingUp size={16} color={LoyaltyColors.accent} />
                  <Text style={styles.tipText}>Earn faster: pay bills, buy event tickets, and refer friends — every action adds points.</Text>
                </View>

                <View style={{ height: Spacing.lg }} />
                <PrimaryButton label="See tier benefits" variant="secondary" onPress={() => router.push('/loyalty/tier-benefits')} />
                <View style={{ height: Spacing.xxl }} />
              </>
            );
          })()}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  card: { backgroundColor: LoyaltyColors.surface, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, ...shadow1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  nextLabel: { ...Typography.labelMd, color: LoyaltyColors.muted },
  bigTrack: { height: 12, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginTop: Spacing.sm },
  bigFill: { height: 12, borderRadius: Radius.full },
  pctText: { ...Typography.labelMd, color: Colors.onSurface },
  toNext: { ...Typography.bodySm, color: LoyaltyColors.muted },
  statsRow: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1, backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 4, ...shadow1 },
  statValue: { ...Typography.titleLg, color: LoyaltyColors.accent },
  statLabel: { ...Typography.bodySm, color: LoyaltyColors.muted },
  tip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: LoyaltyColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md },
  tipText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
