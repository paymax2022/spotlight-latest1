import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Search, TrendingUp, Wallet, PieChart, ListChecks, ChevronRight, GraduationCap, ShieldAlert,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StockRow from '@/features/invest/components/StockRow';
import MarketStatusChip from '@/features/invest/components/MarketStatusChip';
import {
  useEligibility, usePortfolio, useStocks, useMarketStatus, useInvestWallet,
} from '@/features/invest/hooks/useInvest';
import { formatNaira } from '@/features/invest/utils/format';

export default function InvestHomeScreen() {
  const eligibility = useEligibility();
  const portfolio = usePortfolio();
  const wallet = useInvestWallet();
  const stocks = useStocks();
  const market = useMarketStatus();

  const onRefresh = useCallback(() => {
    eligibility.refetch(); portfolio.refetch(); wallet.refetch(); stocks.refetch(); market.refetch();
  }, [eligibility, portfolio, wallet, stocks, market]);

  const canTrade = eligibility.data?.can_trade ?? false;
  const refreshing = portfolio.isRefetching || stocks.isRefetching;

  if (eligibility.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invest" />
        <StateView kind="loading" message="Loading your investing home…" />
      </SafeAreaView>
    );
  }

  const p = portfolio.data;
  const gainUp = (p?.total_gain_kobo ?? 0) >= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Invest"
        rightSlot={
          <Pressable onPress={() => router.push('/invest/discover')} hitSlop={10} accessibilityLabel="Search stocks">
            <Search size={22} color={Colors.onSurface} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: Spacing.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Compliance gate banner */}
        {!canTrade && (
          <Pressable onPress={() => router.push('/invest/onboarding')} style={[styles.gate, shadow1]}>
            <ShieldAlert size={20} color={Colors.onWarning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.gateTitle}>Finish setup to start investing</Text>
              <Text style={styles.gateSub}>
                {!eligibility.data?.suitability_complete ? 'Complete your risk questionnaire' :
                  !eligibility.data?.terms_accepted ? 'Accept the investment terms' :
                  !eligibility.data?.kyc_ok ? 'Upgrade your KYC to tier 2' : 'A few steps remain'}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>
        )}

        {/* Portfolio value card */}
        <View style={styles.section}>
          <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
            <View style={styles.balanceTopRow}>
              <Text style={styles.balanceLabel}>Total portfolio value</Text>
              <MarketStatusChip status={market.data?.market_status} dataStatus="delayed" />
            </View>
            <Text style={styles.balanceValue}>{formatNaira(p?.total_value_kobo ?? 0)}</Text>
            <View style={styles.balanceMetaRow}>
              <Text style={[styles.balanceGain, { color: gainUp ? Colors.tertiaryFixedDim : Colors.errorContainer }]}>
                {formatNaira(p?.total_gain_kobo ?? 0, { sign: true })} all-time
              </Text>
            </View>
            <View style={styles.balanceSplit}>
              <View style={styles.splitItem}>
                <Text style={styles.splitLabel}>Cash</Text>
                <Text style={styles.splitValue}>{formatNaira(wallet.data?.available_cash_kobo ?? 0)}</Text>
              </View>
              <View style={styles.splitItem}>
                <Text style={styles.splitLabel}>Invested</Text>
                <Text style={styles.splitValue}>{formatNaira(p?.invested_value_kobo ?? 0)}</Text>
              </View>
              <View style={styles.splitItem}>
                <Text style={styles.splitLabel}>Pending</Text>
                <Text style={styles.splitValue}>{formatNaira(p?.pending_settlement_kobo ?? 0)}</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <QuickAction icon={<TrendingUp size={20} color={Colors.primary} />} label="Discover" onPress={() => router.push('/invest/discover')} />
          <QuickAction icon={<PieChart size={20} color={Colors.primary} />} label="Portfolio" onPress={() => router.push('/invest/portfolio')} />
          <QuickAction icon={<Wallet size={20} color={Colors.primary} />} label="Wallet" onPress={() => router.push('/invest/wallet')} />
          <QuickAction icon={<ListChecks size={20} color={Colors.primary} />} label="Orders" onPress={() => router.push('/invest/orders')} />
        </View>

        {/* Trending */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Trending stocks</Text>
          <Pressable onPress={() => router.push('/invest/discover')}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>
        <View style={[styles.card, shadow1]}>
          {stocks.isLoading ? (
            <StateView kind="loading" compact message="Loading stocks…" />
          ) : stocks.isError ? (
            <StateView kind="error" compact title="Couldn’t load stocks" actionLabel="Retry" onAction={() => stocks.refetch()} />
          ) : (stocks.data ?? []).slice(0, 5).map((s, i) => (
            <View key={s.id}>
              {i > 0 && <View style={styles.divider} />}
              <StockRow stock={s} />
            </View>
          ))}
        </View>

        {/* Learn card */}
        <Pressable style={[styles.learnCard, shadow1]} onPress={() => router.push('/invest/onboarding')}>
          <View style={styles.learnIcon}><GraduationCap size={22} color={Colors.teal} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.learnTitle}>New to investing?</Text>
            <Text style={styles.learnSub}>Learn how shares, dividends and settlement work before you trade.</Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickAction} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.quickIcon}>{icon}</View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  section: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  gate: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md,
  },
  gateTitle: { ...Typography.labelLg, color: Colors.onSurface },
  gateSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  balanceCard: { borderRadius: Radius.xl, padding: Spacing.cardPadding, gap: Spacing.sm },
  balanceTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  balanceValue: { ...Typography.headlineLg, color: Colors.white },
  balanceMetaRow: { flexDirection: 'row' },
  balanceGain: { ...Typography.labelMd },
  balanceSplit: { flexDirection: 'row', marginTop: Spacing.md, gap: Spacing.md },
  splitItem: { flex: 1 },
  splitLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  splitValue: { ...Typography.labelLg, color: Colors.white },
  quickRow: { flexDirection: 'row', paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, gap: Spacing.sm },
  quickAction: { flex: 1, alignItems: 'center', gap: 6 },
  quickIcon: {
    width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLabel: { ...Typography.labelSm, color: Colors.onSurface },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.sm,
  },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  link: { ...Typography.labelMd, color: Colors.secondary },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginLeft: 72 },
  learnCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  learnIcon: {
    width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal,
    alignItems: 'center', justifyContent: 'center',
  },
  learnTitle: { ...Typography.labelLg, color: Colors.onSurface },
  learnSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
