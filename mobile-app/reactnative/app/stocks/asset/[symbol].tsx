import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Info, Ban, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import StockIcon from '@/features/stocks/components/StockIcon';
import PriceChange from '@/features/stocks/components/PriceChange';
import RiskBadge from '@/features/stocks/components/RiskBadge';
import MarketStatusBadge from '@/features/stocks/components/MarketStatusBadge';
import StockSparkline from '@/features/stocks/components/StockSparkline';
import NewsRow from '@/features/stocks/components/NewsRow';
import DividendRow from '@/features/stocks/components/DividendRow';
import {
  useStock, useStockChart, useStockNews, useDividends, useCorporateActions,
} from '@/features/stocks/hooks/useStocks';
import {
  formatMoneyObj, formatMoneyCompact, formatShares, formatPct, formatDateTime,
} from '@/features/stocks/utils/stockFormatters';
import {
  CHART_RANGES, EXCHANGE_LABEL, NO_ADVICE_DISCLOSURE, MARKET_CLOSED_NOTE,
} from '@/features/stocks/constants/stocks.constants';
import type { ChartRange } from '@/features/stocks/types/stocks.types';

export default function StockDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const asset = useStock(symbol);
  const [range, setRange] = useState<ChartRange>('1D');
  const chart = useStockChart(symbol, range);
  const news = useStockNews(symbol);
  const dividends = useDividends(symbol);
  const actions = useCorporateActions(symbol);

  const chartW = Dimensions.get('window').width - Spacing.containerMargin * 2 - Spacing.md * 2;

  if (asset.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={symbol} />
        <StateView kind="loading" message="Loading stock…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={symbol} />
        <StateView kind="error" title="Couldn't load this stock" message="Please try again in a moment." actionLabel="Retry" onAction={() => asset.refetch()} />
      </SafeAreaView>
    );
  }

  const a = asset.data;
  const available = a.status === 'active' && a.buyEnabled;   // product available to buy
  const closed = a.marketStatus === 'closed';
  const dividendList = dividends.data ?? [];
  const newsList = news.data ?? [];
  const actionList = actions.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={a.name} subtitle={`${a.symbol} · ${EXCHANGE_LABEL[a.exchange]}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Price header */}
        <View style={styles.header}>
          <StockIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <View style={styles.flex}>
            <Text style={styles.price}>{formatMoneyObj(a.price)}</Text>
            <PriceChange pct={a.change24hPct} showIcon />
          </View>
          <MarketStatusBadge status={a.marketStatus} size="sm" />
        </View>

        {/* Chart */}
        <View style={[styles.chartCard, shadow1]}>
          {chart.isLoading ? (
            <View style={[styles.chartPlaceholder, { width: chartW }]}>
              <StateView kind="loading" compact />
            </View>
          ) : (
            <StockSparkline data={chart.data ?? []} width={chartW} height={150} />
          )}
          <View style={styles.rangeWrap}>
            <SegmentedControl<ChartRange> options={CHART_RANGES} value={range} onChange={setRange} />
          </View>
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <Stat label="24h change" value={formatPct(a.change24hPct)} tint={a.change24hPct >= 0 ? Colors.teal : Colors.error} />
          <Stat label="52-wk high" value={formatMoneyObj(a.week52High)} />
          <Stat label="52-wk low" value={formatMoneyObj(a.week52Low)} />
          <Stat label="Market cap" value={formatMoneyCompact(a.marketCap.amount, a.marketCap.currency)} />
          <Stat label="Volume" value={formatShares(a.volume)} />
          <Stat label="Bid / Ask" value={`${formatMoneyObj(a.bid)} / ${formatMoneyObj(a.ask)}`} />
          <Stat label="Sector" value={a.sector} />
          <Stat label="Settlement" value={a.settlementCycle} />
          <Stat label="Commission" value={`${(a.feeBps / 100).toFixed(2)}%`} />
        </View>

        {/* Market closed note */}
        {closed && available ? (
          <View style={styles.note}>
            <Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.noteText}>{MARKET_CLOSED_NOTE}</Text>
          </View>
        ) : null}

        {/* Product-unavailable state */}
        {!available ? (
          <View style={styles.unavailable}>
            <Ban size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.unavailableText}>
              {a.status === 'delisted'
                ? `${a.symbol} has been delisted and is no longer tradable on Paymax.`
                : `Trading for ${a.symbol} is temporarily paused. You can still track its price here.`}
            </Text>
          </View>
        ) : null}

        {/* Risk education */}
        <View style={styles.section}>
          <View style={styles.riskHeader}>
            <Text style={styles.sectionTitle}>Risk</Text>
            <RiskBadge rating={a.riskRating} />
          </View>
          <View style={styles.riskCard}>
            <Text style={styles.bodyText}>{a.riskDisclosure}</Text>
          </View>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About {a.name}</Text>
          <Text style={styles.bodyText}>{a.summary}</Text>
          <View style={styles.disclaimerRow}>
            <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.disclaimer}>{NO_ADVICE_DISCLOSURE}</Text>
          </View>
        </View>

        {/* News */}
        {newsList.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>News</Text>
            <View style={styles.listCard}>
              {newsList.map((n, i, arr) => (
                <View key={n.id}>
                  <NewsRow news={n} />
                  {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Dividends */}
        {dividendList.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dividends</Text>
            <View style={styles.listCard}>
              {dividendList.map((d, i, arr) => (
                <View key={d.id}>
                  <DividendRow dividend={d} />
                  {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Corporate actions */}
        {actionList.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Corporate actions</Text>
            <View style={styles.listCard}>
              {actionList.map((c, i, arr) => (
                <View key={c.id}>
                  <View style={styles.caRow}>
                    <View style={styles.caMid}>
                      <Text style={styles.caTitle} numberOfLines={1}>{c.title}</Text>
                      <Text style={styles.caSub} numberOfLines={2}>{c.description}</Text>
                      <Text style={styles.caDate}>Ex-date {formatDateTime(c.exDate)} · {c.status}</Text>
                    </View>
                  </View>
                  {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky buy/sell footer */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <View style={styles.footerRow}>
          <PrimaryButton
            label="Sell"
            variant="secondary"
            disabled={!a.sellEnabled}
            onPress={() => router.push({ pathname: '/stocks/sell', params: { symbol: a.symbol } })}
            style={styles.footerBtn}
          />
          <PrimaryButton
            label={available ? 'Buy' : 'Unavailable'}
            disabled={!available}
            onPress={() => router.push({ pathname: '/stocks/buy', params: { symbol: a.symbol } })}
            style={styles.footerBtn}
          />
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tint ? { color: tint } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  price: { ...Typography.headlineMd, color: Colors.onSurface },
  chartCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.md,
  },
  chartPlaceholder: { height: 150, alignItems: 'center', justifyContent: 'center' },
  rangeWrap: { marginHorizontal: -Spacing.md + Spacing.containerMargin },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: Spacing.md, gap: Spacing.sm },
  statCell: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg, padding: Spacing.md, gap: 4,
  },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.md,
  },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  unavailable: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.md,
  },
  unavailableText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  section: { marginTop: Spacing.lg },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  riskHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  riskCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  bodyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 24 },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.sm },
  disclaimer: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
  listCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  caRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: Spacing.md },
  caMid: { flex: 1, gap: 3 },
  caTitle: { ...Typography.labelLg, color: Colors.onSurface },
  caSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 20 },
  caDate: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, backgroundColor: Colors.background },
  footerRow: { flexDirection: 'row', gap: Spacing.sm },
  footerBtn: { flex: 1 },
});
