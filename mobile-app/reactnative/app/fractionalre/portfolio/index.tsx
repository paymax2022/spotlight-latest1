import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, TrendingUp, Coins, FileText, Repeat } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePortfolio, useHoldings } from '@/features/fractionalre/hooks';
import { formatNaira, formatNairaCompact, formatYield } from '@/features/fractionalre/utils';
import { KIND_LABEL } from '@/features/fractionalre/constants';
import AllocationDonut from '@/features/fractionalre/components/AllocationDonut';

export default function PortfolioOverview() {
  const portfolio = usePortfolio();
  const holdings = useHoldings();

  if (portfolio.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Portfolio" />
        <StateView kind="loading" message="Loading portfolio…" />
      </SafeAreaView>
    );
  }
  const p = portfolio.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Portfolio" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Total value</Text>
          <Text style={styles.heroValue}>{p ? formatNaira(p.totalValueKobo) : '₦0'}</Text>
          <View style={styles.heroStats}>
            <Stat label="Invested" value={p ? formatNairaCompact(p.investedKobo) : '—'} />
            <Stat label="Returns" value={p ? formatNairaCompact(p.totalReturnsKobo) : '—'} />
            <Stat label="Unrealised" value={p ? formatNairaCompact(p.unrealisedGainKobo) : '—'} />
          </View>
        </View>

        <View style={styles.quickRow}>
          <Quick icon={Coins} label="Payouts" onPress={() => router.push('/fractionalre/portfolio/payouts')} />
          <Quick icon={FileText} label="Statements" onPress={() => router.push('/fractionalre/portfolio/statements')} />
          <Quick icon={Repeat} label="Auto-invest" onPress={() => router.push('/fractionalre/portfolio/auto-invest')} />
        </View>

        {p && p.allocation.some((a) => a.pct > 0) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Allocation</Text>
            <AllocationDonut
              slices={p.allocation}
              centerLabel="Holdings"
              centerValue={String(p.holdingsCount)}
            />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Your holdings</Text>
        {(holdings.data?.length ?? 0) === 0 ? (
          <StateView kind="empty" compact title="No holdings yet" message="Invest in an opportunity to build your portfolio." icon="Building2" />
        ) : (
          (holdings.data ?? []).map((h) => {
            const gain = h.currentValueKobo - h.investedKobo;
            return (
              <Pressable key={h.id} style={styles.holdingRow} onPress={() => router.push(`/fractionalre/portfolio/${h.id}` as never)}>
                <View style={styles.holdingLeft}>
                  <Text style={styles.holdingTitle} numberOfLines={1}>{h.title}</Text>
                  <Text style={styles.holdingSub}>{KIND_LABEL[h.kind]} · {h.units} units · {formatYield(h.projectedYieldBps)}</Text>
                </View>
                <View style={styles.holdingRight}>
                  <Text style={styles.holdingVal}>{formatNaira(h.currentValueKobo)}</Text>
                  <View style={styles.gainRow}>
                    <TrendingUp size={12} color={gain >= 0 ? Colors.teal : Colors.error} strokeWidth={2} />
                    <Text style={[styles.gain, { color: gain >= 0 ? Colors.teal : Colors.error }]}>
                      {gain >= 0 ? '+' : ''}{formatNairaCompact(gain)}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function Quick({ icon: Icon, label, onPress }: { icon: typeof Coins; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quick} onPress={onPress}>
      <View style={styles.quickIcon}><Icon size={18} color={Colors.primary} strokeWidth={2} /></View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  heroValue: { ...Typography.headlineLg, color: Colors.onPrimary },
  heroStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  stat: { alignItems: 'flex-start' },
  statVal: { ...Typography.labelLg, color: Colors.onPrimary },
  statLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  quickRow: { flexDirection: 'row', justifyContent: 'space-around' },
  quick: { alignItems: 'center', gap: 6 },
  quickIcon: { width: 48, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...Typography.labelSm, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  holdingRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  holdingLeft: { flex: 1 },
  holdingTitle: { ...Typography.labelLg, color: Colors.onSurface },
  holdingSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  holdingRight: { alignItems: 'flex-end' },
  holdingVal: { ...Typography.labelLg, color: Colors.onSurface },
  gainRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gain: { ...Typography.labelSm, fontWeight: '600' },
});
