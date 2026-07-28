import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gift, Vote, Wallet, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useStreamSummary } from '@/features/connect/live/hooks';

/** Live earnings overlay / summary (PRD §10.7 LB-07). All amounts in kobo. */
export default function EarningsScreen() {
  const q = useStreamSummary();

  if (q.isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Earnings" /><StateView kind="loading" message="Loading earnings…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><ScreenHeader title="Earnings" /><StateView kind="error" title="Couldn't load earnings" actionLabel="Retry" onAction={() => q.refetch()} /></SafeAreaView>;
  const s = q.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings" subtitle="This stream" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total this stream</Text>
          <Text style={styles.totalValue}>{formatKobo(s.totalEarningsKobo)}</Text>
          <Text style={styles.totalSub}>Real Naira credited to your Paymax wallet</Text>
        </View>

        <View style={styles.breakdown}>
          <View style={styles.breakRow}>
            <View style={[styles.breakIcon, { backgroundColor: Colors.iconBgPurple }]}><Gift size={18} color={ConnectColors.brand} strokeWidth={2.2} /></View>
            <Text style={styles.breakLabel}>Gifts</Text>
            <Text style={styles.breakValue}>{formatKobo(s.giftRevenueKobo)}</Text>
          </View>
          <View style={styles.breakRow}>
            <View style={[styles.breakIcon, { backgroundColor: Colors.iconBgBlue }]}><Vote size={18} color={Colors.secondary} strokeWidth={2.2} /></View>
            <Text style={styles.breakLabel}>Paid votes</Text>
            <Text style={styles.breakValue}>{formatKobo(s.voteRevenueKobo)}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Top supporters</Text>
        {s.topGifters.map((g, i) => (
          <View key={g.name} style={styles.gifterRow}>
            <Text style={styles.gifterRank}>{i + 1}</Text>
            <Text style={styles.gifterName}>{g.name}</Text>
            <Text style={styles.gifterAmount}>{formatKobo(g.amountKobo)}</Text>
          </View>
        ))}

        <View style={styles.payoutBox}>
          <Wallet size={18} color={ConnectColors.ok} strokeWidth={2.2} />
          <Text style={styles.payoutText}>Earnings are spendable and withdrawable from your wallet, subject to your KYC tier limits. Withdrawals require Tier 2+.</Text>
        </View>

        <View style={styles.trendRow}>
          <TrendingUp size={15} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
          <Text style={styles.trendText}>See full earnings history in your creator dashboard.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  totalCard: { backgroundColor: ConnectColors.brand, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 4 },
  totalLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  totalValue: { ...Typography.displayLg, color: Colors.onPrimary, fontWeight: '800' as const },
  totalSub: { ...Typography.caption, color: Colors.inversePrimary },
  breakdown: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.sm },
  breakRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.sm },
  breakIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  breakLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  breakValue: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface },
  gifterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, borderWidth: 1, borderColor: ConnectColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  gifterRank: { ...Typography.labelLg, color: ConnectColors.brand, width: 20 },
  gifterName: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  gifterAmount: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  payoutBox: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: ConnectColors.okBg, borderRadius: Radius.lg, padding: Spacing.md },
  payoutText: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trendText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
