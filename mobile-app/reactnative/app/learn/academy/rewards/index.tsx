import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Gift, ArrowUpRight, ArrowDownLeft, Lock, CloudOff, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import { useRewardBalance, useRewardHistory, useMe } from '@/features/academy/hooks';
import { formatDate, formatPoints } from '@/features/academy/constants';

/** G6 — Rewards center. Earned points & how to earn; gate redeem for minors. */
export default function RewardsCenter() {
  const balance = useRewardBalance();
  const history = useRewardHistory();
  const me = useMe();

  const locked = me.data?.isMinor && me.data?.guardianConsent !== 'granted';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rewards" subtitle="Learn-to-earn" />
      <OfflineBanner />
      {balance.isLoading ? (
        <StateView kind="loading" message="Loading rewards…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
            <Gift size={24} color={Colors.gold} />
            <Text style={styles.heroPts}>{(balance.data?.points ?? 0).toLocaleString()}</Text>
            <Text style={styles.heroLabel}>reward points</Text>
            {(balance.data?.pendingPoints ?? 0) > 0 ? (
              <View style={styles.pendingPill}>
                <CloudOff size={12} color={Colors.onWarning} />
                <Text style={styles.pendingText}>{balance.data?.pendingPoints} pending sync</Text>
              </View>
            ) : null}
            <Text style={styles.lifetime}>Lifetime earned: {formatPoints(balance.data?.lifetimeEarned)}</Text>
          </LinearGradient>

          {locked ? (
            <View style={[styles.lockedCard, shadow1]}>
              <Lock size={18} color={Colors.onWarning} />
              <Text style={styles.lockedText}>Redeeming needs guardian consent. Ask your parent/guardian to approve in onboarding.</Text>
            </View>
          ) : null}

          <Pressable style={[styles.redeemBtn, locked && styles.redeemDisabled]} disabled={locked} onPress={() => router.push('/learn/academy/rewards/redeem')}>
            <Sparkles size={18} color={Colors.onPrimary} />
            <Text style={styles.redeemText}>Redeem rewards</Text>
          </Pressable>

          {/* How to earn */}
          <Text style={styles.section}>How to earn</Text>
          <View style={[styles.earnCard, shadow1]}>
            <EarnRow label="Complete a practice set" pts="+50" />
            <EarnRow label="Finish a mock exam" pts="+300" />
            <EarnRow label="Extend your streak" pts="+200" />
            <EarnRow label="Master a topic" pts="+20" />
          </View>

          {/* Recent ledger (G8 lite) */}
          <Text style={styles.section}>Recent activity</Text>
          {history.data?.slice(0, 8).map((h) => (
            <View key={h.id} style={[styles.row, shadow1]}>
              <View style={[styles.rowIcon, { backgroundColor: h.kind === 'earn' ? Colors.iconBgTeal : Colors.iconBgGold }]}>
                {h.kind === 'earn' ? <ArrowDownLeft size={16} color={Colors.teal} /> : <ArrowUpRight size={16} color={Colors.onWarning} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{h.reason}</Text>
                <Text style={styles.rowMeta}>{formatDate(h.ts)}{!h.synced ? ' · pending sync' : ''}</Text>
              </View>
              <Text style={[styles.rowPts, { color: h.points >= 0 ? Colors.teal : Colors.error }]}>{h.points >= 0 ? '+' : ''}{h.points}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function EarnRow({ label, pts }: { label: string; pts: string }) {
  return (
    <View style={styles.earnRow}>
      <Text style={styles.earnLabel}>{label}</Text>
      <Text style={styles.earnPts}>{pts}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center' },
  heroPts: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 48, lineHeight: 54, marginTop: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  pendingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, marginTop: Spacing.sm },
  pendingText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' },
  lifetime: { ...Typography.labelSm, color: Colors.inversePrimary, marginTop: Spacing.sm },
  lockedCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, padding: Spacing.md, borderRadius: Radius.lg },
  lockedText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  redeemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.primary },
  redeemDisabled: { opacity: 0.5 },
  redeemText: { ...Typography.labelLg, color: Colors.onPrimary },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  earnCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  earnRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  earnLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  earnPts: { ...Typography.labelMd, color: Colors.teal },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.bodyMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowPts: { ...Typography.titleMd },
});
