import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Send, ArrowDown, RefreshCw, ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import BalanceCard from '@/components/BalanceCard';
import RecentActivityCard, { Activity } from '@/components/RecentActivityCard';
import SectionHeader from '@/components/SectionHeader';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { getWallet } from '@/api/wallet.api';
import { getWalletLedger, getWalletFlowSummary, type WalletLedgerEntry } from '@/api/walletLedger.api';
// Shared formatter — this screen's own copy used minimumFractionDigits:0, so a
// total ending in a round ten of kobo lost its last digit (₦13,645.20 read as
// "₦13,645.2"). Its comment claimed "one place so every wallet number matches";
// src/utils/money.ts is that place.
import { formatNaira } from '@/utils/money';

const TABS = ['All', 'Credit', 'Debit'];

// A ledger entry → a display row. Icon/colour reflect the money direction; the
// title prefers the ledger description, falling back to the reference/type.
function entryToActivity(e: WalletLedgerEntry): Activity {
  const isCredit = e.direction === 'credit';
  const meta = e.metadata ?? {};
  const label =
    e.description?.trim() ||
    (typeof meta.title === 'string' ? meta.title : '') ||
    (typeof meta.category === 'string' ? meta.category : '') ||
    (isCredit ? 'Money in' : 'Money out');
  const when = e.createdAt ? new Date(e.createdAt) : null;
  return {
    id:        e.id,
    title:     label,
    subtitle:  e.reference || (e.type.startsWith('REVERSAL') ? 'Reversal' : isCredit ? 'Credit' : 'Debit'),
    amount:    e.amountKobo / 100,
    type:      isCredit ? 'credit' : 'debit',
    icon:      isCredit ? 'ArrowDownLeft' : 'ArrowUpRight',
    iconColor: isCredit ? Colors.teal : Colors.primary,
    bgColor:   isCredit ? Colors.iconBgTeal : Colors.iconBgPurple,
    date:      when && !isNaN(when.getTime()) ? when.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '',
  };
}

export default function WalletScreen() {
  const [tab, setTab] = useState('All');

  const { data: wallet, isRefetching: wRefetch, refetch: refetchWallet } = useQuery({
    queryKey: ['wallet'],
    queryFn:  getWallet,
  });

  const { data: entries, isLoading: txLoading, isRefetching: txRefetch, refetch: refetchTx } = useQuery({
    queryKey: ['wallet-ledger'],
    queryFn:  () => getWalletLedger({ limit: 50 }),
  });

  // Income / Expenses are computed over the ENTIRE ledger, not just the page
  // shown below — so the totals are complete and reconcile with the balance.
  const { data: summary, isRefetching: sumRefetch, refetch: refetchSummary } = useQuery({
    queryKey: ['wallet-flow-summary'],
    queryFn:  getWalletFlowSummary,
  });

  const activities = (entries ?? []).map(entryToActivity);
  const filtered   = tab === 'All' ? activities : activities.filter((a) => (tab === 'Credit' ? a.type === 'credit' : a.type === 'debit'));
  const totalInKobo  = summary?.incomeKobo ?? 0;
  const totalOutKobo = summary?.expensesKobo ?? 0;

  const handleRefresh = () => { refetchWallet(); refetchTx(); refetchSummary(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 100 : 80 }}
        refreshControl={<RefreshControl refreshing={wRefetch || txRefetch || sumRefetch} onRefresh={handleRefresh} tintColor={Colors.primary} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>My Wallet</Text>
        </View>

        <BalanceCard
          balance={wallet?.balance ?? 0}
          currency={wallet?.currency ?? 'NGN'}
          quickActions={[
            { id: 'add',      label: 'Add Money', icon: <Plus      size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/wallet/add' as never) },
            { id: 'send',     label: 'Send',      icon: <Send      size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/wallet/send' as never) },
            { id: 'withdraw', label: 'Withdraw',  icon: <ArrowDown size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/wallet/withdraw' as never) },
            { id: 'exchange', label: 'Exchange',  icon: <RefreshCw size={20} color={Colors.onPrimary} strokeWidth={2} />, onPress: () => router.push('/services/fx' as never) },
          ]}
        />

        <View style={styles.statsRow}>
          <LinearGradient colors={[Colors.iconBgTeal, 'rgba(72,184,172,0.04)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.statCard, shadow1]}>
            <View style={[styles.statIcon, { backgroundColor: Colors.iconBgTeal }]}>
              <ArrowDownLeft size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.statLabel}>Income</Text>
            <Text style={[styles.statAmount, { color: Colors.teal }]}>{formatNaira(totalInKobo)}</Text>
          </LinearGradient>
          <LinearGradient colors={['rgba(220,38,38,0.06)', 'rgba(220,38,38,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.statCard, shadow1]}>
            <View style={[styles.statIcon, { backgroundColor: 'rgba(220,38,38,0.08)' }]}>
              <ArrowUpRight size={18} color={Colors.error} strokeWidth={2} />
            </View>
            <Text style={styles.statLabel}>Expenses</Text>
            <Text style={[styles.statAmount, { color: Colors.error }]}>{formatNaira(totalOutKobo)}</Text>
          </LinearGradient>
        </View>

        <SectionHeader title="Transactions" />

        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabBtn, t === tab && styles.tabBtnActive]}>
              <Text style={[styles.tabLabel, t === tab && styles.tabLabelActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        {txLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: Spacing.lg }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{activities.length === 0 ? 'No transactions yet.' : `No ${tab.toLowerCase()} transactions.`}</Text>
          </View>
        ) : (
          <View style={[styles.list, shadow1]}>
            {filtered.map((a, i) => (
              <Pressable key={a.id} onPress={() => router.push(`/wallet/transaction/${a.id}` as never)}>
                <RecentActivityCard activity={a} />
                {i < filtered.length - 1 && <View style={styles.divider} />}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  header:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title:    { ...Typography.headlineMd, color: Colors.onSurface },
  statsRow: { flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  statCard: { flex: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  statIcon: { width: 36, height: 36, borderRadius: Radius.sm + 4, alignItems: 'center', justifyContent: 'center' },
  statLabel:{ ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statAmount:{ ...Typography.titleMd, fontWeight: '700' },
  tabRow:   { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  tabBtn:   { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  tabBtnActive:   { backgroundColor: Colors.primaryContainer },
  tabLabel:       { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tabLabelActive: { color: Colors.onPrimaryContainer },
  empty:    { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyText:{ ...Typography.bodyMd, color: Colors.outline },
  list:     { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, marginHorizontal: Spacing.containerMargin, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  divider:  { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
