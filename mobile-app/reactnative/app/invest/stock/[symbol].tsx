import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MarketStatusChip from '@/features/invest/components/MarketStatusChip';
import Sparkline from '@/features/invest/components/Sparkline';
import { useStock, useStockChart } from '@/features/invest/hooks/useInvest';
import { formatNaira, formatPct, formatQty } from '@/features/invest/utils/format';

export default function StockDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = String(symbol);
  const stock = useStock(sym);
  const chart = useStockChart(sym, '1m');
  const width = Dimensions.get('window').width - Spacing.containerMargin * 2 - Spacing.cardPadding * 2;

  if (stock.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={sym} />
        <StateView kind="loading" message="Loading stock…" />
      </SafeAreaView>
    );
  }
  if (stock.isError || !stock.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={sym} />
        <StateView kind="error" title="Couldn’t load stock" actionLabel="Retry" onAction={() => stock.refetch()} />
      </SafeAreaView>
    );
  }

  const s = stock.data;
  const q = s.quote;
  const up = q.day_change_kobo >= 0;
  const tradable = s.status === 'active' && (s.buy_enabled || s.sell_enabled);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={s.symbol} subtitle={s.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={styles.priceBlock}>
          <Text style={styles.price}>{formatNaira(q.price_kobo)}</Text>
          <Text style={[styles.change, { color: up ? Colors.teal : Colors.error }]}>
            {formatNaira(q.day_change_kobo, { sign: true })} ({formatPct(q.day_change_pct)}) today
          </Text>
          <View style={{ marginTop: Spacing.sm }}>
            <MarketStatusChip status={q.market_status} dataStatus={q.data_status} />
          </View>
        </View>

        <View style={[styles.card, shadow1]}>
          {chart.isLoading ? (
            <StateView kind="loading" compact />
          ) : (
            <Sparkline candles={chart.data ?? []} width={width} height={130} />
          )}
        </View>

        <View style={[styles.statsCard, shadow1]}>
          <Stat label="52-wk high" value={formatNaira(q.high_52w_kobo)} />
          <Stat label="52-wk low" value={formatNaira(q.low_52w_kobo)} />
          <Stat label="Volume" value={formatQty(q.volume)} />
          <Stat label="Sector" value={s.sector || '—'} />
          <Stat label="Risk rating" value={s.risk_rating} />
          <Stat label="Settlement" value={`T+${s.settlement_days}`} />
          <Stat label="Min. order" value={formatNaira(s.minimum_order_amount)} />
          <Stat label="Exchange" value={s.exchange} />
        </View>

        {!!s.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.body}>{s.description}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What happens after I buy?</Text>
          <Text style={styles.body}>
            Your cash is locked when you place an order, then shares are credited to your portfolio
            after settlement (T+{s.settlement_days}). Fees are always shown before you confirm.
          </Text>
        </View>

        <Text style={styles.disclaimer}>
          This is educational information, not financial advice. Stock prices can rise or fall.
          Market data is {q.data_status}.
        </Text>
      </ScrollView>

      {/* Sticky buy/sell bar */}
      <View style={styles.actionBar}>
        {tradable ? (
          <>
            <PrimaryButton label="Sell" variant="secondary" onPress={() => router.push(`/invest/sell?symbol=${s.symbol}`)} style={{ flex: 1 }} fullWidth={false} />
            <PrimaryButton label="Buy" onPress={() => router.push(`/invest/buy?symbol=${s.symbol}`)} style={{ flex: 1 }} fullWidth={false} />
          </>
        ) : (
          <View style={styles.unavailable}>
            <Text style={styles.unavailableText}>Trading is currently unavailable for this stock.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  priceBlock: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  price: { ...Typography.headlineLg, color: Colors.onSurface },
  change: { ...Typography.labelLg, marginTop: 2 },
  card: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant,
    alignItems: 'center',
  },
  statsCard: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant,
    flexDirection: 'row', flexWrap: 'wrap',
  },
  stat: { width: '50%', paddingVertical: Spacing.sm },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statValue: { ...Typography.labelLg, color: Colors.onSurface },
  section: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.xs },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  disclaimer: {
    ...Typography.labelSm, color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, fontStyle: 'italic',
  },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: Spacing.md,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xl,
    backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  unavailable: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md },
  unavailableText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
