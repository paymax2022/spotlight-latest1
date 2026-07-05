import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, Circle, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useReferralDashboard, useReferralMilestones } from '@/features/referral/rewards/hooks';
import { TIER_TABLE, MILESTONE_TABLE, formatNaira, formatRate, EARN_PROMISE, RewardColors } from '@/features/referral/rewards/constants';
import { RewardHeader, Card } from '@/features/referral/rewards/components';

// PRD §5.1.5 — Tier & Rewards Explainer. Full tier table (current highlighted),
// full milestone table (achieved checked), plain-language promise.
export default function TierExplainer() {
  const dash = useReferralDashboard();
  const ms = useReferralMilestones();

  const currentTier = dash.data?.current_tier;
  const achievedThresholds = new Set((ms.data?.achieved ?? []).map((a) => a.threshold));

  if (dash.isLoading || ms.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <RewardHeader title="Tiers & rewards" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <RewardHeader title="Tiers & rewards" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Promise */}
        <Card style={styles.promise}>
          <View style={styles.promiseIcon}><Info size={20} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.promiseText}>{EARN_PROMISE}</Text>
        </Card>

        {/* Tier table */}
        <Text style={styles.sectionTitle}>Your ongoing share rate</Text>
        <Text style={styles.sectionSub}>The more active referrals you have, the higher your share of the platform margin on their purchases.</Text>
        <Card style={styles.tableCard}>
          <View style={[styles.tRow, styles.tHead]}>
            <Text style={[styles.tCell, styles.tCellTier, styles.tHeadText]}>Tier</Text>
            <Text style={[styles.tCell, styles.tCellRange, styles.tHeadText]}>Active referrals</Text>
            <Text style={[styles.tCell, styles.tCellRate, styles.tHeadText]}>Rate</Text>
          </View>
          {TIER_TABLE.map((t) => {
            const on = t.tier === currentTier;
            const range = t.max_count == null ? `${t.min_count.toLocaleString()}+` : `${t.min_count}–${t.max_count}`;
            return (
              <View key={t.tier} style={[styles.tRow, on && styles.tRowActive]}>
                <View style={[styles.tCell, styles.tCellTier]}>
                  <Text style={[styles.tTier, on && styles.tActiveText]}>{t.label}</Text>
                  {on ? <Text style={styles.youTag}>You</Text> : null}
                </View>
                <Text style={[styles.tCell, styles.tCellRange, styles.tText, on && styles.tActiveText]}>{range}</Text>
                <Text style={[styles.tCell, styles.tCellRate, styles.tRate, on && styles.tActiveText]}>{formatRate(t.rate)}</Text>
              </View>
            );
          })}
        </Card>

        {/* Milestone table */}
        <Text style={styles.sectionTitle}>One-time milestone bonuses</Text>
        <Text style={styles.sectionSub}>Paid once, the first time your active referral count crosses a threshold. These stack on top of your ongoing share.</Text>
        <Card style={styles.tableCard}>
          {MILESTONE_TABLE.map((m) => {
            const done = achievedThresholds.has(m.threshold);
            return (
              <View key={m.threshold} style={styles.msRow}>
                {done ? <CheckCircle2 size={22} color={RewardColors.ok} strokeWidth={2} /> : <Circle size={22} color={Colors.outlineVariant} strokeWidth={2} />}
                <Text style={[styles.msLabel, done && styles.msDone]}>{m.threshold.toLocaleString()} active referrals</Text>
                <Text style={[styles.msBonus, done && styles.msDone]}>{formatNaira(m.bonus_kobo)}</Text>
              </View>
            );
          })}
        </Card>

        <Text style={styles.footNote}>
          Your rate can move up as your active count grows. If your active count drops, only the rate on
          future purchases changes — rewards already credited are never clawed back for a tier change.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  promise: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.iconBgPurple, borderColor: Colors.primaryFixedDim },
  promiseIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center' },
  promiseText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, fontWeight: '600', lineHeight: 21 },

  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  sectionSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs, lineHeight: 19 },

  tableCard: { padding: 0, overflow: 'hidden' },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: Spacing.md, borderBottomWidth: 1, borderBottomColor: RewardColors.border },
  tHead: { backgroundColor: Colors.surfaceContainerLow },
  tRowActive: { backgroundColor: Colors.iconBgPurple },
  tCell: {},
  tCellTier: { flex: 1.1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tCellRange: { flex: 1.3 },
  tCellRate: { flex: 0.7, textAlign: 'right' },
  tHeadText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700' },
  tTier: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  tText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tRate: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '800' },
  tActiveText: { color: Colors.primary },
  youTag: { ...Typography.caption, color: Colors.onPrimary, backgroundColor: Colors.primary, paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.full, overflow: 'hidden', fontWeight: '700' },

  msRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: 14, paddingHorizontal: Spacing.md, borderBottomWidth: 1, borderBottomColor: RewardColors.border },
  msLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  msBonus: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '800' },
  msDone: { color: RewardColors.ok },

  footNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.md, lineHeight: 20 },
});
