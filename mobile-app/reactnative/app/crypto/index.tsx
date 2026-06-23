import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  ArrowDownToLine, ArrowUpFromLine, PieChart, Receipt, ChevronRight,
  ShieldAlert, Eye, GraduationCap, Star,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import AssetRow from '@/features/crypto/components/AssetRow';
import HoldingRow from '@/features/crypto/components/HoldingRow';
import CryptoTransactionRow from '@/features/crypto/components/CryptoTransactionRow';
import PriceChange from '@/features/crypto/components/PriceChange';
import {
  useAssets, useCryptoPortfolio, useCryptoTransactions, useCryptoEligibility, useWatchlist,
} from '@/features/crypto/hooks/useCrypto';
import { formatFiatObj } from '@/features/crypto/utils/cryptoFormatters';

export default function CryptoHomeScreen() {
  const eligibility = useCryptoEligibility();
  const assets = useAssets();
  const portfolio = useCryptoPortfolio();
  const txns = useCryptoTransactions();
  const watchlist = useWatchlist();

  const eligible = eligibility.data?.state === 'eligible';
  const gateCopy = useMemo(() => {
    switch (eligibility.data?.state) {
      case 'kyc_required':
        return { title: 'Verify your identity to trade', sub: 'Complete KYC to start buying and selling crypto.', cta: '/fx/kyc' as const };
      case 'kyc_pending':
        return { title: 'Verification in progress', sub: 'We\'ll unlock crypto trading once you\'re approved.', cta: '/fx/kyc/status' as const };
      case 'suitability_required':
        return { title: 'Complete your risk profile', sub: 'A quick suitability check is required before trading.', cta: '/crypto' as const };
      case 'restricted':
        return { title: 'Trading restricted', sub: eligibility.data.message, cta: '/crypto' as const };
      case 'product_unavailable':
        return { title: 'Crypto isn\'t available in your region', sub: eligibility.data.message, cta: '/crypto' as const };
      default:
        return null;
    }
  }, [eligibility.data]);

  const trending = (assets.data ?? []).filter((a) => a.status === 'active').slice(0, 4);
  const holdings = portfolio.data?.positions ?? [];
  const recent = txns.data ?? [];
  const watched = watchlist.data ?? [];

  const refreshing = assets.isRefetching || portfolio.isRefetching;
  const onRefresh = () => { assets.refetch(); portfolio.refetch(); txns.refetch(); };

  const quickActions = [
    { id: 'buy', label: 'Buy', icon: <ArrowDownToLine size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/crypto/assets') },
    { id: 'sell', label: 'Sell', icon: <ArrowUpFromLine size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/crypto/portfolio') },
    { id: 'portfolio', label: 'Portfolio', icon: <PieChart size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/crypto/portfolio') },
    { id: 'history', label: 'History', icon: <Receipt size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/crypto/transactions') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Crypto"
        subtitle="Buy, sell & track digital assets"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/crypto/watchlist')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Watchlist">
              <Star size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => router.push('/crypto/transactions')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Transaction history">
              <Receipt size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {portfolio.isLoading || eligibility.isLoading ? (
          <StateView kind="loading" message="Loading your crypto…" />
        ) : portfolio.isError ? (
          <StateView kind="error" title="Couldn't load crypto" message="Please check your connection and try again." actionLabel="Retry" onAction={() => portfolio.refetch()} />
        ) : (
          <>
            {/* Eligibility / KYC gate banner */}
            {!eligible && gateCopy ? (
              <Pressable style={[styles.gate, shadow1]} onPress={() => router.push(gateCopy.cta)} accessibilityRole="button" accessibilityLabel={gateCopy.title}>
                <View style={styles.gateIcon}><ShieldAlert size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={styles.flex}>
                  <Text style={styles.alertTitle}>{gateCopy.title}</Text>
                  <Text style={styles.alertSub}>{gateCopy.sub}</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ) : null}

            {/* Portfolio snapshot hero */}
            <LinearGradient colors={Colors.gradientPurple as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
              <Text style={styles.heroLabel}>Crypto holdings value</Text>
              <Text style={styles.heroAmount}>{formatFiatObj(portfolio.data!.totalValue)}</Text>
              <View style={styles.heroChangeRow}>
                <View style={styles.heroPill}>
                  <PriceChange pct={portfolio.data!.dayChangePct} showIcon textStyle={styles.heroPillText} />
                </View>
                <Text style={styles.heroChangeText}>
                  {formatFiatObj(portfolio.data!.dayChange)} today
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
              <View style={styles.investIcon}><Eye size={16} color={Colors.secondary} strokeWidth={2} /></View>
              <View style={styles.flex}>
                <Text style={styles.investLabel}>Available to invest</Text>
                <Text style={styles.investValue}>{formatFiatObj(portfolio.data!.investableBalance)}</Text>
              </View>
              <Pressable onPress={() => router.push('/crypto/assets')} accessibilityRole="button">
                <Text style={styles.investCta}>Buy crypto</Text>
              </Pressable>
            </View>

            {/* Your holdings */}
            <View style={styles.section}>
              <SectionHeader title="Your holdings" actionLabel={holdings.length ? 'See all' : undefined} onAction={() => router.push('/crypto/portfolio')} />
              {holdings.length === 0 ? (
                <StateView kind="empty" icon="Wallet" title="No crypto yet" message="Start with as little as ₦1,000 — buy your first asset to see it here." actionLabel="Explore assets" onAction={() => router.push('/crypto/assets')} compact />
              ) : (
                <View style={styles.card}>
                  {holdings.slice(0, 3).map((p, i, arr) => (
                    <View key={p.assetId}>
                      <HoldingRow position={p} onPress={() => router.push(`/crypto/asset/${p.symbol}`)} />
                      {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Watchlist */}
            {watched.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Watchlist" actionLabel="See all" onAction={() => router.push('/crypto/watchlist')} />
                <View style={styles.card}>
                  {watched.slice(0, 3).map((a, i, arr) => (
                    <View key={a.id}>
                      <AssetRow asset={a} onPress={() => router.push(`/crypto/asset/${a.symbol}`)} />
                      {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Trending / markets */}
            <View style={styles.section}>
              <SectionHeader title="Markets" actionLabel="See all" onAction={() => router.push('/crypto/assets')} />
              {assets.isLoading ? (
                <StateView kind="loading" compact />
              ) : (
                <View style={styles.card}>
                  {trending.map((a, i, arr) => (
                    <View key={a.id}>
                      <AssetRow asset={a} onPress={() => router.push(`/crypto/asset/${a.symbol}`)} />
                      {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Learn nudge (education-first) */}
            <Pressable style={[styles.learn, shadow1]} accessibilityRole="button" onPress={() => router.push('/crypto')}>
              <View style={styles.learnIcon}><GraduationCap size={18} color={Colors.teal} strokeWidth={2} /></View>
              <View style={styles.flex}>
                <Text style={styles.alertTitle}>New to crypto?</Text>
                <Text style={styles.alertSub}>Learn how it works, the risks, and how to stay safe before you trade.</Text>
              </View>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>

            {/* Recent activity */}
            <View style={styles.section}>
              <SectionHeader title="Recent activity" actionLabel={recent.length ? 'See all' : undefined} onAction={() => router.push('/crypto/transactions')} />
              {recent.length === 0 ? (
                <StateView kind="empty" icon="Receipt" title="No transactions yet" message="Your buys and sells will appear here." compact />
              ) : (
                <View style={styles.card}>
                  {recent.slice(0, 4).map((t, i, arr) => (
                    <View key={t.id}>
                      <CryptoTransactionRow tx={t} onPress={() => router.push(`/crypto/transactions/${t.id}`)} />
                      {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                    </View>
                  ))}
                </View>
              )}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  section: { marginTop: Spacing.lg },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },

  gate: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md, marginBottom: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.primaryFixed, padding: Spacing.md,
  },
  gateIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
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

  learn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  learnIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
});
