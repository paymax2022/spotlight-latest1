import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ChevronRight, ScrollText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import HoldingRow from '@/features/stocks/components/HoldingRow';
import PriceChange from '@/features/stocks/components/PriceChange';
import { useStockPortfolio } from '@/features/stocks/hooks/useStocks';
import { formatMoneyObj } from '@/features/stocks/utils/stockFormatters';

export default function StockPortfolioScreen() {
  const portfolio = useStockPortfolio();

  if (portfolio.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Stock portfolio" />
        <StateView kind="loading" message="Loading your portfolio…" />
      </SafeAreaView>
    );
  }
  if (portfolio.isError || !portfolio.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Stock portfolio" />
        <StateView kind="error" title="Couldn't load portfolio" message="Please check your connection and try again." actionLabel="Retry" onAction={() => portfolio.refetch()} />
      </SafeAreaView>
    );
  }

  const d = portfolio.data;
  const positions = d.positions;
  const totalValue = d.totalValue.amount || 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Stock portfolio"
        subtitle="Holdings & performance"
        rightSlot={
          <Pressable onPress={() => router.push('/stocks/orders')} hitSlop={8} accessibilityRole="button" accessibilityLabel="View orders">
            <ScrollText size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={portfolio.isRefetching} onRefresh={() => portfolio.refetch()} tintColor={Colors.primary} />}
      >
        {positions.length === 0 ? (
          <StateView kind="empty" icon="PieChart" title="No holdings yet" message="Buy your first stock to start tracking performance here." actionLabel="Explore stocks" onAction={() => router.push('/stocks/list')} />
        ) : (
          <>
            {/* Summary hero */}
            <LinearGradient colors={Colors.gradientPurple as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
              <Text style={styles.heroLabel}>Total value</Text>
              <Text style={styles.heroAmount}>{formatMoneyObj(d.totalValue)}</Text>
              <View style={styles.heroChangeRow}>
                <View style={styles.heroPill}>
                  <PriceChange pct={d.totalGainLossPct} showIcon textStyle={styles.heroPillText} />
                </View>
                <Text style={styles.heroChangeText}>{formatMoneyObj(d.totalGainLoss)} all-time</Text>
              </View>

              <View style={styles.heroDivider} />

              <View style={styles.heroStats}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Invested</Text>
                  <Text style={styles.heroStatValue}>{formatMoneyObj(d.totalCostBasis)}</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Today</Text>
                  <Text style={styles.heroStatValue}>{formatMoneyObj(d.dayChange)}</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatLabel}>Cash</Text>
                  <Text style={styles.heroStatValue}>{formatMoneyObj(d.investableBalance)}</Text>
                </View>
              </View>
            </LinearGradient>

            {/* Allocation bars */}
            <View style={styles.section}>
              <SectionHeader title="Allocation" />
              <View style={[styles.allocCard, shadow1]}>
                {positions.map((p) => {
                  const pct = Math.round((p.marketValue.amount / totalValue) * 100);
                  return (
                    <View key={p.assetId} style={styles.allocRow}>
                      <View style={styles.allocHead}>
                        <Text style={styles.allocName}>{p.symbol}</Text>
                        <Text style={styles.allocPct}>{pct}%</Text>
                      </View>
                      <View style={styles.allocTrack}>
                        <View style={[styles.allocFill, { width: `${Math.max(2, pct)}%`, backgroundColor: p.iconColor }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Holdings list */}
            <View style={styles.section}>
              <SectionHeader title="Holdings" />
              <View style={styles.card}>
                {positions.map((p, i, arr) => (
                  <View key={p.assetId}>
                    <View style={styles.holdingWrap}>
                      <View style={styles.flex}>
                        <HoldingRow position={p} onPress={() => router.push(`/stocks/asset/${p.symbol}`)} />
                      </View>
                      <Pressable
                        style={styles.sellBtn}
                        onPress={() => router.push({ pathname: '/stocks/sell', params: { symbol: p.symbol } })}
                        accessibilityRole="button"
                        accessibilityLabel={`Sell ${p.symbol}`}
                      >
                        <Text style={styles.sellText}>Sell</Text>
                        <ChevronRight size={14} color={Colors.secondary} strokeWidth={2} />
                      </Pressable>
                    </View>
                    {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  section: { marginTop: Spacing.lg },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },

  hero: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    borderRadius: Radius.xl, padding: Spacing.cardPadding, overflow: 'hidden',
  },
  heroLabel: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  heroAmount: { fontSize: 30, fontWeight: '800', color: Colors.onPrimary, lineHeight: 38, letterSpacing: -0.5, marginTop: Spacing.xs },
  heroChangeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  heroPill: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  heroPillText: { color: Colors.onPrimary },
  heroChangeText: { ...Typography.labelSm, color: 'rgba(255,255,255,0.8)' },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: Spacing.md },
  heroStats: { flexDirection: 'row', justifyContent: 'space-between' },
  heroStat: { gap: 2 },
  heroStatLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.7)' },
  heroStatValue: { ...Typography.labelLg, color: Colors.onPrimary },

  allocCard: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md, gap: Spacing.md,
  },
  allocRow: { gap: 6 },
  allocHead: { flexDirection: 'row', justifyContent: 'space-between' },
  allocName: { ...Typography.labelMd, color: Colors.onSurface },
  allocPct: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  allocTrack: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  allocFill: { height: 8, borderRadius: Radius.full },

  holdingWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sellBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingHorizontal: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  sellText: { ...Typography.labelMd, color: Colors.secondary },
});
