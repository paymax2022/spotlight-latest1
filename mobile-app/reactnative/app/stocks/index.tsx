import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  ArrowDownToLine, ArrowUpFromLine, PieChart, Receipt, ChevronRight,
  Wallet, GraduationCap, Megaphone,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import StockRow from '@/features/stocks/components/StockRow';
import HoldingRow from '@/features/stocks/components/HoldingRow';
import PriceChange from '@/features/stocks/components/PriceChange';
import { useStocks, useStockPortfolio } from '@/features/stocks/hooks/useStocks';
import { formatMoneyObj } from '@/features/stocks/utils/stockFormatters';
import { NO_ADVICE_DISCLOSURE } from '@/features/stocks/constants/stocks.constants';

export default function StocksHomeScreen() {
  const stocks = useStocks();
  const portfolio = useStockPortfolio();

  const holdings = portfolio.data?.positions ?? [];

  // Top movers — active assets sorted by absolute day move.
  const movers = (stocks.data ?? [])
    .filter((a) => a.status === 'active')
    .slice()
    .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))
    .slice(0, 4);

  const refreshing = stocks.isRefetching || portfolio.isRefetching;
  const onRefresh = () => { stocks.refetch(); portfolio.refetch(); };

  const quickActions = [
    { id: 'buy', label: 'Buy', icon: <ArrowDownToLine size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/stocks/list') },
    { id: 'sell', label: 'Sell', icon: <ArrowUpFromLine size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/stocks/portfolio') },
    { id: 'portfolio', label: 'Portfolio', icon: <PieChart size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/stocks/portfolio') },
    { id: 'orders', label: 'Orders', icon: <Receipt size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/stocks/orders') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Stocks"
        subtitle="Invest in shares & ETFs"
        rightSlot={
          <Pressable onPress={() => router.push('/stocks/orders')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Orders">
            <Receipt size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {portfolio.isLoading ? (
          <StateView kind="loading" message="Loading your portfolio…" />
        ) : portfolio.isError ? (
          <StateView kind="error" title="Couldn't load stocks" message="Please check your connection and try again." actionLabel="Retry" onAction={() => portfolio.refetch()} />
        ) : (
          <>
            {/* Portfolio snapshot hero */}
            <LinearGradient colors={Colors.gradientPurple as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
              <Text style={styles.heroLabel}>Stock holdings value</Text>
              <Text style={styles.heroAmount}>{formatMoneyObj(portfolio.data!.totalValue)}</Text>
              <View style={styles.heroChangeRow}>
                <View style={styles.heroPill}>
                  <PriceChange pct={portfolio.data!.dayChangePct} showIcon textStyle={styles.heroPillText} />
                </View>
                <Text style={styles.heroChangeText}>
                  {formatMoneyObj(portfolio.data!.dayChange)} today
                </Text>
              </View>

              <View style={styles.heroDivider} />

              <View style={styles.actionsRow}>
                {quickActions.map((a) => (
                  <Pressable key={a.id} onPress={a.onPress} style={({ pressed }) => [styles.actionBtn, pressed && styles.actionPressed]} accessibilityRole="button" accessibilityLabel={a.label}>
                    <View style={styles.actionIcon}>{a.icon}</View>
                    <Text style={styles.actionLabel}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
            </LinearGradient>

            {/* Investable cash hint */}
            <View style={[styles.investCard, shadow1]}>
              <View style={styles.investIcon}><Wallet size={16} color={Colors.secondary} strokeWidth={2} /></View>
              <View style={styles.flex}>
                <Text style={styles.investLabel}>Available to invest</Text>
                <Text style={styles.investValue}>{formatMoneyObj(portfolio.data!.investableBalance)}</Text>
              </View>
              <Pressable onPress={() => router.push('/stocks/list')} accessibilityRole="button">
                <Text style={styles.investCta}>Buy stocks</Text>
              </Pressable>
            </View>

            {/* Your holdings */}
            <View style={styles.section}>
              <SectionHeader title="Your holdings" actionLabel={holdings.length ? 'See all' : undefined} onAction={() => router.push('/stocks/portfolio')} />
              {holdings.length === 0 ? (
                <StateView kind="empty" icon="LineChart" title="No holdings yet" message="Buy your first stock or ETF to start building a portfolio." actionLabel="Explore stocks" onAction={() => router.push('/stocks/list')} compact />
              ) : (
                <View style={styles.card}>
                  {holdings.slice(0, 3).map((p, i, arr) => (
                    <View key={p.assetId}>
                      <HoldingRow position={p} onPress={() => router.push(`/stocks/asset/${p.symbol}`)} />
                      {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Markets / top movers */}
            <View style={styles.section}>
              <SectionHeader title="Markets" actionLabel="See all" onAction={() => router.push('/stocks/list')} />
              {stocks.isLoading ? (
                <StateView kind="loading" compact />
              ) : stocks.isError ? (
                <StateView kind="error" title="Couldn't load markets" message="Please try again." actionLabel="Retry" onAction={() => stocks.refetch()} compact />
              ) : (
                <View style={styles.card}>
                  {movers.map((a, i, arr) => (
                    <View key={a.id}>
                      <StockRow asset={a} onPress={() => router.push(`/stocks/asset/${a.symbol}`)} />
                      {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Public offers teaser */}
            <Pressable style={[styles.offer, shadow1]} accessibilityRole="button" onPress={() => router.push('/stocks/offers')}>
              <View style={styles.offerIcon}><Megaphone size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <View style={styles.flex}>
                <Text style={styles.alertTitle}>Public offers</Text>
                <Text style={styles.alertSub}>Browse IPOs and rights issues open for application.</Text>
              </View>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>

            {/* Learn nudge (education-first) */}
            <Pressable style={[styles.learn, shadow1]} accessibilityRole="button" onPress={() => router.push('/stocks/list')}>
              <View style={styles.learnIcon}><GraduationCap size={18} color={Colors.teal} strokeWidth={2} /></View>
              <View style={styles.flex}>
                <Text style={styles.alertTitle}>New to investing?</Text>
                <Text style={styles.alertSub}>{NO_ADVICE_DISCLOSURE}</Text>
              </View>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
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

  alertTitle: { ...Typography.labelLg, color: Colors.onSurface },
  alertSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1, lineHeight: 16 },

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
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionBtn: { alignItems: 'center', gap: Spacing.xs, flex: 1 },
  actionPressed: { opacity: 0.7 },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.caption, color: Colors.onPrimary, textAlign: 'center' },

  investCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  investIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  investLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  investValue: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 1 },
  investCta: { ...Typography.labelMd, color: Colors.secondary },

  offer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  offerIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },

  learn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  learnIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
});
