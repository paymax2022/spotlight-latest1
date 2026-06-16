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
import { getWallet, getWalletTransactions } from '@/api/wallet.api';
import { Transaction } from '@/types/transaction';

const TABS = ['All', 'Credit', 'Debit'];

const SERVICE_ICON_MAP: Record<string, string> = {
  AIRTIME:     'Smartphone',
  DATA:        'Wifi',
  ELECTRICITY: 'Zap',
  CABLE_TV:    'Tv',
};
const SERVICE_COLOR_MAP: Record<string, { iconColor: string; bgColor: string }> = {
  AIRTIME:     { iconColor: Colors.primary, bgColor: Colors.iconBgPurple },
  DATA:        { iconColor: Colors.secondary, bgColor: Colors.iconBgBlue },
  ELECTRICITY: { iconColor: '#EAB308', bgColor: 'rgba(234,179,8,0.10)' },
  CABLE_TV:    { iconColor: Colors.teal, bgColor: Colors.iconBgTeal },
};

function txToActivity(tx: Transaction): Activity {
  const svc     = tx.serviceType ?? 'AIRTIME';
  const clr     = SERVICE_COLOR_MAP[svc] ?? { iconColor: Colors.primary, bgColor: Colors.iconBgPurple };
  const isCredit = tx.status === 'REFUNDED' || tx.status === 'REVERSED';
  return {
    id:        tx.id,
    title:     tx.productName ?? tx.providerName ?? svc,
    subtitle:  tx.customerIdentifier,
    amount:    isCredit ? tx.totalAmount : -tx.totalAmount,
    type:      isCredit ? 'credit' : 'debit',
    icon:      SERVICE_ICON_MAP[svc] ?? 'Circle',
    iconColor: clr.iconColor,
    bgColor:   clr.bgColor,
    date:      new Date(tx.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
  };
}

export default function WalletScreen() {
  const [tab, setTab] = useState('All');

  const { data: wallet, isRefetching: wRefetch, refetch: refetchWallet } = useQuery({
    queryKey: ['wallet'],
    queryFn:  getWallet,
  });

  const { data: txPage, isLoading: txLoading, isRefetching: txRefetch, refetch: refetchTx } = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn:  () => getWalletTransactions({ limit: 50 }),
  });

  const activities = (txPage?.items ?? []).map(txToActivity);
  const filtered   = tab === 'All' ? activities : activities.filter((a) => (tab === 'Credit' ? a.type === 'credit' : a.type === 'debit'));
  const totalIn    = activities.filter((a) => a.type === 'credit').reduce((s, a) => s + a.amount, 0);
  const totalOut   = activities.filter((a) => a.type === 'debit').reduce((s, a) => s + Math.abs(a.amount), 0);

  const handleRefresh = () => { refetchWallet(); refetchTx(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 100 : 80 }}
        refreshControl={<RefreshControl refreshing={wRefetch || txRefetch} onRefresh={handleRefresh} tintColor={Colors.primary} />}
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
            <Text style={[styles.statAmount, { color: Colors.teal }]}>₦{totalIn.toLocaleString('en-NG')}</Text>
          </LinearGradient>
          <LinearGradient colors={['rgba(220,38,38,0.06)', 'rgba(220,38,38,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.statCard, shadow1]}>
            <View style={[styles.statIcon, { backgroundColor: 'rgba(220,38,38,0.08)' }]}>
              <ArrowUpRight size={18} color={Colors.error} strokeWidth={2} />
            </View>
            <Text style={styles.statLabel}>Expenses</Text>
            <Text style={[styles.statAmount, { color: Colors.error }]}>₦{totalOut.toLocaleString('en-NG')}</Text>
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
            <Text style={styles.emptyText}>No transactions yet.</Text>
          </View>
        ) : (
          <View style={[styles.list, shadow1]}>
            {filtered.map((a, i) => (
              <Pressable key={a.id} onPress={() => router.push(`/services/transactions/${a.id}` as never)}>
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
