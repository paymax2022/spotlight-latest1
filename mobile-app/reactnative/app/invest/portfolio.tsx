import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePortfolio } from '@/features/invest/hooks/useInvest';
import { formatNaira, formatQty, formatPct } from '@/features/invest/utils/format';

export default function PortfolioScreen() {
  const portfolio = usePortfolio();
  const p = portfolio.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Portfolio" />
      {portfolio.isLoading ? (
        <StateView kind="loading" message="Loading your portfolio…" />
      ) : portfolio.isError ? (
        <StateView kind="error" title="Couldn’t load portfolio" actionLabel="Retry" onAction={() => portfolio.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: Spacing.xxl }}
          refreshControl={<RefreshControl refreshing={portfolio.isRefetching} onRefresh={() => portfolio.refetch()} tintColor={Colors.primary} />}
        >
          <View style={[styles.summary, shadow1]}>
            <Text style={styles.summaryLabel}>Total value</Text>
            <Text style={styles.summaryValue}>{formatNaira(p?.total_value_kobo ?? 0)}</Text>
            <Text style={[styles.summaryGain, { color: (p?.total_gain_kobo ?? 0) >= 0 ? Colors.teal : Colors.error }]}>
              {formatNaira(p?.total_gain_kobo ?? 0, { sign: true })} all-time
            </Text>
            <View style={styles.summarySplit}>
              <Split label="Cash" value={formatNaira(p?.cash_balance_kobo ?? 0)} />
              <Split label="Invested" value={formatNaira(p?.invested_value_kobo ?? 0)} />
              <Split label="Pending" value={formatNaira(p?.pending_settlement_kobo ?? 0)} />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Holdings</Text>
          {(p?.positions ?? []).length === 0 ? (
            <StateView kind="empty" compact title="No holdings yet" message="Buy your first stock to start building your portfolio." actionLabel="Discover stocks" onAction={() => router.push('/invest/discover')} />
          ) : (
            <View style={[styles.card, shadow1]}>
              {(p?.positions ?? []).map((pos, i) => {
                const gainUp = pos.unrealized_gain_kobo >= 0;
                const pct = pos.average_cost_kobo > 0
                  ? ((pos.current_price_kobo - pos.average_cost_kobo) / pos.average_cost_kobo) * 100 : 0;
                return (
                  <Pressable key={pos.id} onPress={() => router.push(`/invest/stock/${pos.symbol}`)}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.holding}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.holdingSym}>{pos.symbol}</Text>
                        <Text style={styles.holdingSub}>{formatQty(pos.quantity)} units · avg {formatNaira(pos.average_cost_kobo)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.holdingValue}>{formatNaira(pos.market_value_kobo)}</Text>
                        <Text style={[styles.holdingGain, { color: gainUp ? Colors.teal : Colors.error }]}>
                          {formatNaira(pos.unrealized_gain_kobo, { sign: true })} ({formatPct(pct)})
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Split({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.split}>
      <Text style={styles.splitLabel}>{label}</Text>
      <Text style={styles.splitValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  summary: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  summaryLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.headlineLg, color: Colors.onSurface, marginTop: 2 },
  summaryGain: { ...Typography.labelLg, marginTop: 2 },
  summarySplit: { flexDirection: 'row', marginTop: Spacing.md, gap: Spacing.md },
  split: { flex: 1 },
  splitLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  splitValue: { ...Typography.labelLg, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  holding: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, paddingHorizontal: Spacing.md },
  holdingSym: { ...Typography.labelLg, color: Colors.onSurface },
  holdingSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  holdingValue: { ...Typography.labelLg, color: Colors.onSurface },
  holdingGain: { ...Typography.labelSm },
});
