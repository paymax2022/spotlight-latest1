import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Network, Info, Ban, Star, BellPlus, ArrowLeftRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import PriceChange from '@/features/crypto/components/PriceChange';
import RiskBadge from '@/features/crypto/components/RiskBadge';
import CryptoSparkline from '@/features/crypto/components/CryptoSparkline';
import VolatilityWarning from '@/features/crypto/components/VolatilityWarning';
import { useAsset, useChart, useWatchlist, useToggleWatchlist } from '@/features/crypto/hooks/useCrypto';
import { formatFiatObj, formatFiatCompact, formatPct } from '@/features/crypto/utils/cryptoFormatters';
import { CHART_RANGES, NO_ADVICE_DISCLOSURE } from '@/features/crypto/constants/crypto.constants';
import type { ChartRange } from '@/features/crypto/types/crypto.types';

export default function AssetDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const asset = useAsset(symbol);
  const [range, setRange] = useState<ChartRange>('1D');
  const chart = useChart(symbol, range);
  const watchlist = useWatchlist();
  const toggleWatch = useToggleWatchlist();
  const watched = (watchlist.data ?? []).some((w) => w.symbol === symbol);

  const chartW = Dimensions.get('window').width - Spacing.containerMargin * 2 - Spacing.md * 2;

  if (asset.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={symbol} />
        <StateView kind="loading" message="Loading asset…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={symbol} />
        <StateView kind="error" title="Couldn't load this asset" message="Please try again in a moment." actionLabel="Retry" onAction={() => asset.refetch()} />
      </SafeAreaView>
    );
  }

  const a = asset.data;
  const tradable = a.status === 'active' && a.buyEnabled;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={a.name}
        subtitle={a.symbol}
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => toggleWatch.mutate({ assetId: a.id, watched })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <Star size={22} color={watched ? Colors.gold : Colors.onSurface} strokeWidth={2} fill={watched ? Colors.gold : 'transparent'} />
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: '/crypto/alerts/new', params: { symbol: a.symbol } })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Set price alert"
            >
              <BellPlus size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Price header */}
        <View style={styles.header}>
          <AssetIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <View style={styles.flex}>
            <Text style={styles.price}>{formatFiatObj(a.price)}</Text>
            <PriceChange pct={a.change24hPct} showIcon />
          </View>
          <RiskBadge rating={a.riskRating} />
        </View>

        {/* Chart */}
        <View style={[styles.chartCard, shadow1]}>
          {chart.isLoading ? (
            <View style={[styles.chartPlaceholder, { width: chartW }]}>
              <StateView kind="loading" compact />
            </View>
          ) : (
            <CryptoSparkline data={chart.data ?? []} width={chartW} height={150} />
          )}
          <View style={styles.rangeWrap}>
            <SegmentedControl<ChartRange> options={CHART_RANGES} value={range} onChange={setRange} />
          </View>
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <Stat label="24h change" value={formatPct(a.change24hPct)} tint={a.change24hPct >= 0 ? Colors.teal : Colors.error} />
          <Stat label="Market cap" value={formatFiatCompact(a.marketCap.amount, a.marketCap.currency)} />
          <Stat label="24h volume" value={formatFiatCompact(a.volume24h.amount, a.volume24h.currency)} />
          <Stat label="Min order" value={formatFiatObj(a.price.amount > 0 ? { amount: a.minOrderAmount, currency: a.price.currency } : a.price)} />
        </View>

        {/* Product-unavailable state */}
        {!tradable ? (
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
          <Text style={styles.sectionTitle}>Risk</Text>
          <VolatilityWarning message={a.riskDisclosure} />
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About {a.name}</Text>
          <Text style={styles.bodyText}>{a.description}</Text>
          <View style={styles.disclaimerRow}>
            <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.disclaimer}>{NO_ADVICE_DISCLOSURE}</Text>
          </View>
        </View>

        {/* Swap shortcut */}
        {tradable ? (
          <Pressable style={styles.swapRow} onPress={() => router.push({ pathname: '/crypto/swap', params: { from: a.symbol } })} accessibilityRole="button" accessibilityLabel={`Swap ${a.symbol}`}>
            <View style={styles.swapIcon}><ArrowLeftRight size={16} color={Colors.secondary} strokeWidth={2} /></View>
            <Text style={styles.swapText}>Swap {a.symbol} for another asset</Text>
          </Pressable>
        ) : null}

        {/* Supported networks */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Supported networks</Text>
          <View style={styles.networkCard}>
            {a.supportedNetworks.map((n, i, arr) => (
              <View key={n.id}>
                <View style={styles.networkRow}>
                  <View style={styles.networkIcon}><Network size={16} color={Colors.secondary} strokeWidth={2} /></View>
                  <Text style={styles.networkName}>{n.name}</Text>
                  <Text style={styles.networkConf}>{n.confirmations} conf.</Text>
                </View>
                {i < arr.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Sticky buy/sell footer */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {tradable ? (
          <View style={styles.footerRow}>
            <PrimaryButton label="Sell" variant="secondary" onPress={() => router.push({ pathname: '/crypto/sell', params: { symbol: a.symbol } })} style={styles.footerBtn} />
            <PrimaryButton label="Buy" onPress={() => router.push({ pathname: '/crypto/buy', params: { symbol: a.symbol } })} style={styles.footerBtn} />
          </View>
        ) : (
          <PrimaryButton label="Trading unavailable" onPress={() => {}} disabled />
        )}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
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
  unavailable: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.md,
  },
  unavailableText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  section: { marginTop: Spacing.lg },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  swapIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  swapText: { ...Typography.labelLg, color: Colors.onSurface },
  bodyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 24 },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.sm },
  disclaimer: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
  networkCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md,
  },
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  networkIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  networkName: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  networkConf: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, backgroundColor: Colors.background },
  footerRow: { flexDirection: 'row', gap: Spacing.sm },
  footerBtn: { flex: 1 },
});
