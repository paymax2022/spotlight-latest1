import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeftRight, Send, ArrowDownToLine, CreditCard, Plus, ChevronRight,
  Bell, TriangleAlert, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import BalanceCard from '@/components/BalanceCard';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import RateTicker from '@/features/fx/components/RateTicker';
import CurrencyWalletCard from '@/features/fx/components/CurrencyWalletCard';
import RateSparkline from '@/features/fx/components/RateSparkline';
import TransactionRow from '@/features/fx/components/TransactionRow';
import { useBalances, useRates, useTransactions, useRateHistory } from '@/features/fx/hooks/useFx';
import { useVerification } from '@/features/fx/hooks/useFxKyc';
import { ShieldCheck, Settings, Megaphone } from 'lucide-react-native';
import { FX_ANNOUNCEMENTS, CURRENCY_ORDER } from '@/features/fx/constants/fx.constants';
import { midRate, formatPct, formatRate } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode } from '@/features/fx/types/fx.types';
import { Dimensions } from 'react-native';

const LOW_BALANCE_NGN = 50_000_00; // ₦50k threshold for the low-balance alert

// Currencies the headline toggle always offers, even before the user has opened
// that wallet — tapping USD then shows a true $0.00 next to the "Add currency
// wallet" CTA, rather than hiding the option until money is already there.
const HEADLINE_CURRENCIES: CurrencyCode[] = ['NGN', 'USD'];

export default function FxHomeScreen() {
  const balances = useBalances();
  const rates = useRates();
  const txns = useTransactions();
  const featured = useRateHistory('USD', 'NGN', '1W');
  const verification = useVerification();
  const verified = verification.data?.status === 'approved';
  const verifyCopy = verification.data?.status === 'pending'
    ? { title: 'Verification in progress', sub: 'We\'ll unlock everything once you\'re approved.', cta: '/fx/kyc/status' as const }
    : verification.data?.status === 'review'
    ? { title: 'Account under review', sub: 'Your business details are being reviewed.', cta: '/fx/kyc/status' as const }
    : verification.data?.status === 'rejected'
    ? { title: 'Verification needs attention', sub: 'Please resubmit your details to continue.', cta: '/fx/kyc/status' as const }
    : { title: 'Verify your account', sub: 'Required before you can convert, send or hold money.', cta: '/fx/kyc' as const };

  const [selected, setSelected] = useState<CurrencyCode>('NGN');

  // The toggle offers NGN + USD plus anything else the user actually holds, in
  // the app's canonical currency order.
  const walletCurrencies = useMemo(() => {
    const held = (balances.data ?? []).map((b) => b.currency);
    const set = new Set<CurrencyCode>([...HEADLINE_CURRENCIES, ...held]);
    return CURRENCY_ORDER.filter((c) => set.has(c));
  }, [balances.data]);

  // The headline is the SELECTED wallet's own fetched balance in its own
  // currency. It used to be every wallet summed into naira at `midRate` — a
  // hardcoded client-side rate table, so the figure was never a real balance and
  // could not be reconciled against anything the backend held.
  const selectedBalance = (balances.data ?? []).find((b) => b.currency === selected)?.available ?? 0;

  const pending = (txns.data ?? []).filter((t) => t.status === 'processing' || t.status === 'pending');
  const lowWallet = (balances.data ?? []).find(
    (b) => b.available > 0 && Math.round(b.available * midRate(b.currency, 'NGN')) < LOW_BALANCE_NGN,
  );
  const usdNgn = rates.data?.find((r) => r.pair === 'USD-NGN');
  const chartW = Dimensions.get('window').width - Spacing.containerMargin * 2 - Spacing.md * 2;

  const quickActions = [
    { id: 'convert', label: 'Convert', icon: <ArrowLeftRight size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/fx/convert') },
    { id: 'send', label: 'Send', icon: <Send size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/fx/send') },
    { id: 'receive', label: 'Receive', icon: <ArrowDownToLine size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/fx/receive') },
    { id: 'cards', label: 'Card', icon: <CreditCard size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/fx/cards') },
  ];

  const refreshing = balances.isRefetching || rates.isRefetching;
  const onRefresh = () => { balances.refetch(); rates.refetch(); txns.refetch(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="FX Exchange"
        subtitle="Multi-currency wallet"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/fx/notifications')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Notifications">
              <Bell size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => router.push('/fx/settings')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Settings">
              <Settings size={22} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {balances.isLoading ? (
          <StateView kind="loading" message="Loading your balances…" />
        ) : balances.isError ? (
          <StateView kind="error" title="Couldn't load balances" message="Please check your connection and try again." actionLabel="Retry" onAction={() => balances.refetch()} />
        ) : (
          <>
            {verification.data && !verified ? (
              <Pressable
                style={[styles.verifyBanner, shadow1]}
                onPress={() => router.push(verifyCopy.cta)}
                accessibilityRole="button"
                accessibilityLabel={verifyCopy.title}
              >
                <View style={styles.verifyIcon}><ShieldCheck size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={styles.flex}>
                  <Text style={styles.alertTitle}>{verifyCopy.title}</Text>
                  <Text style={styles.alertSub}>{verifyCopy.sub}</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ) : null}

            <BalanceCard
              balance={selectedBalance / 100}
              currency={selected}
              label={`${selected} Wallet`}
              currencies={walletCurrencies}
              onSelectCurrency={(c) => setSelected(c as CurrencyCode)}
              quickActions={quickActions}
            />

            {/* Live rate ticker */}
            <View style={styles.tickerWrap}>
              <SectionHeader title="Live rates" actionLabel="Alerts" onAction={() => router.push('/fx/rate-alerts')} />
              {rates.isLoading
                ? <StateView kind="loading" compact />
                : <RateTicker rates={rates.data ?? []} onPressRate={() => router.push('/fx/convert')} />}
            </View>

            {/* Low-balance alert */}
            {lowWallet ? (
              <Pressable style={[styles.alert, shadow1]} onPress={() => router.push('/fx/receive')} accessibilityRole="button">
                <View style={styles.alertIcon}><TriangleAlert size={18} color={Colors.error} strokeWidth={2} /></View>
                <View style={styles.flex}>
                  <Text style={styles.alertTitle}>Low {lowWallet.currency} balance</Text>
                  <Text style={styles.alertSub}>Top up to keep conversions and payouts flowing.</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ) : null}

            {/* Pending transactions card */}
            {pending.length > 0 ? (
              <Pressable style={[styles.pending, shadow1]} onPress={() => router.push('/fx/transactions')} accessibilityRole="button">
                <View style={styles.pendingIcon}><Clock size={18} color={Colors.onPrimaryFixedVariant} strokeWidth={2} /></View>
                <View style={styles.flex}>
                  <Text style={styles.alertTitle}>{pending.length} pending {pending.length === 1 ? 'transaction' : 'transactions'}</Text>
                  <Text style={styles.alertSub}>Awaiting provider settlement.</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            ) : null}

            {/* Wallets */}
            <View style={styles.section}>
              <SectionHeader title="Your wallets" />
              <View style={styles.walletList}>
                {(balances.data ?? []).map((b) => (
                  <CurrencyWalletCard key={b.currency} balance={b} onPress={() => router.push('/fx/convert')} />
                ))}
                <Pressable style={styles.addWallet} onPress={() => router.push('/fx/add-wallet')} accessibilityRole="button" accessibilityLabel="Add currency wallet">
                  <Plus size={18} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.addWalletText}>Add currency wallet</Text>
                </Pressable>
              </View>
            </View>

            {/* Rate movement card */}
            {usdNgn ? (
              <View style={styles.section}>
                <Pressable style={[styles.moveCard, shadow1]} onPress={() => router.push('/fx/convert')} accessibilityRole="button">
                  <View style={styles.moveTop}>
                    <View>
                      <Text style={styles.movePair}>USD / NGN</Text>
                      <Text style={styles.moveRate}>{formatRate('USD', 'NGN', usdNgn.sell)}</Text>
                    </View>
                    <Text style={[styles.moveChange, { color: usdNgn.change24hPct >= 0 ? Colors.teal : Colors.error }]}>
                      {formatPct(usdNgn.change24hPct)}
                    </Text>
                  </View>
                  <RateSparkline data={featured.data ?? []} width={chartW} height={90} color={Colors.secondary} />
                </Pressable>
              </View>
            ) : null}

            {/* Announcements */}
            <View style={styles.section}>
              <SectionHeader title="Announcements" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.annRow}>
                {FX_ANNOUNCEMENTS.map((a) => (
                  <View key={a.id} style={[styles.annCard, shadow1]}>
                    <View style={styles.annIcon}><Megaphone size={16} color={Colors.primary} strokeWidth={2} /></View>
                    <Text style={styles.annTitle} numberOfLines={1}>{a.title}</Text>
                    <Text style={styles.annBody} numberOfLines={3}>{a.body}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* Recent transactions */}
            <View style={styles.section}>
              <SectionHeader title="Recent activity" actionLabel="See all" onAction={() => router.push('/fx/transactions')} />
              {txns.isLoading ? (
                <StateView kind="loading" compact />
              ) : (txns.data ?? []).length === 0 ? (
                <StateView kind="empty" icon="ArrowLeftRight" title="No transactions yet" message="Your conversions and payouts will appear here." compact />
              ) : (
                <View style={styles.txCard}>
                  {(txns.data ?? []).slice(0, 4).map((t, i, arr) => (
                    <View key={t.id}>
                      <TransactionRow tx={t} onPress={() => router.push(`/fx/transactions/${t.id}`)} />
                      {i < arr.length - 1 ? <View style={styles.txDivider} /> : null}
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
  verifyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md, marginBottom: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.primaryFixed, padding: Spacing.md,
  },
  verifyIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  tickerWrap: { marginBottom: Spacing.sm },
  section: { marginTop: Spacing.lg },
  walletList: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  addWallet: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.secondary, marginTop: 2,
  },
  addWalletText: { ...Typography.labelLg, color: Colors.secondary },
  alert: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.errorContainer, padding: Spacing.md,
  },
  alertIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  pending: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  pendingIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { ...Typography.labelLg, color: Colors.onSurface },
  alertSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  moveCard: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  moveTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.sm },
  movePair: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  moveRate: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  moveChange: { ...Typography.labelLg },
  txCard: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  txDivider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  annRow: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  annCard: { width: 240, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6 },
  annIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  annTitle: { ...Typography.labelLg, color: Colors.onSurface },
  annBody: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 16 },
});

