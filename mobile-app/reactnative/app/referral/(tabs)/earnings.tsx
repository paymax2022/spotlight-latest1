import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, ChevronRight, FileText, Hourglass, Coins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ReferralHeader, EarnStatePill } from '@/features/referral/components';
import { EarnStateKey } from '@/features/referral/constants/referral.constants';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useLedger } from '@/features/referral/earnings/hooks';
import { useDashboard } from '@/features/referral/home/hooks';
import type { RewardLedgerRow } from '@/features/referral/earnings/types';

// M-ERN-01 — Earnings ledger: full timeline across ALL reward-ledger states (§7).
type Filter = 'all' | EarnStateKey;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'eligible', label: 'Ready' },
  { value: 'vesting', label: 'Vesting' },
  { value: 'pending', label: 'Pending' },
  { value: 'earned', label: 'Earned' },
  { value: 'paid', label: 'Paid' },
  { value: 'clawed_back', label: 'Reversed' },
];

export default function ReferralEarningsTab() {
  const { data, isLoading, isError, refetch } = useLedger();
  const dash = useDashboard();
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const list = data ?? [];
    return filter === 'all' ? list : list.filter((r) => r.state === filter);
  }, [data, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Earnings" showBack={false} showNotifications showHelp />
      {isLoading ? (
        <StateView kind="loading" message="Loading your earnings…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Wallet" title="No earnings yet" message="When friends you invite verify and transact for real, your rewards show up here." />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.headerWrap}>
              {/* Eligible balance + actions */}
              <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>Ready to withdraw</Text>
                <Text style={styles.balanceValue}>{formatNaira(dash.data?.snapshot.eligibleKobo ?? 0)}</Text>
                <View style={styles.balanceActions}>
                  <Action icon={<Wallet size={16} color={Colors.onPrimary} strokeWidth={2} />} label="Withdraw" primary onPress={() => router.push('/referral/earnings/withdraw')} />
                  <Action icon={<Hourglass size={16} color={Colors.onSurface} strokeWidth={2} />} label="Vesting" onPress={() => router.push('/referral/earnings/vesting-tracker')} />
                  <Action icon={<FileText size={16} color={Colors.onSurface} strokeWidth={2} />} label="Statement" onPress={() => router.push('/referral/earnings/statement')} />
                </View>
              </View>

              <View style={styles.quickRow}>
                <Pressable style={styles.quickChip} onPress={() => router.push('/referral/earnings/currency-selector')} accessibilityRole="button">
                  <Coins size={15} color={Colors.onSurface} strokeWidth={2} />
                  <Text style={styles.quickChipText}>Reward currency</Text>
                </Pressable>
                <Pressable style={styles.quickChip} onPress={() => router.push('/referral/earnings/catalog-redeem')} accessibilityRole="button">
                  <Coins size={15} color={Colors.onSurface} strokeWidth={2} />
                  <Text style={styles.quickChipText}>Redeem points</Text>
                </Pressable>
              </View>

              <View style={styles.filterWrap}>
                <SegmentedControl<Filter> value={filter} onChange={setFilter} options={FILTERS} scrollable />
              </View>
            </View>
          }
          ListEmptyComponent={<StateView kind="empty" icon="Wallet" title="Nothing here" message="No rewards in this state yet." />}
          renderItem={({ item }) => <LedgerRow row={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function Action({ icon, label, onPress, primary }: { icon: React.ReactNode; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable style={[styles.action, primary ? styles.actionPrimary : styles.actionGhost]} onPress={onPress} accessibilityRole="button">
      {icon}
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function LedgerRow({ row }: { row: RewardLedgerRow }) {
  return (
    <Pressable style={styles.row} onPress={() => router.push({ pathname: '/referral/earnings/reward-detail', params: { id: row.id } })} accessibilityRole="button">
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowTitle}>{rowTitle(row)}</Text>
        <Text style={styles.rowSub}>{relativeTime(row.updatedAt)}</Text>
        <EarnStatePill state={row.state} />
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, row.state === 'clawed_back' && styles.rowAmountNeg]}>
          {row.state === 'clawed_back' ? `−${formatNaira(row.amountKobo)}` : formatNaira(row.amountKobo)}
        </Text>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

function rowTitle(row: RewardLedgerRow): string {
  if (row.kind === 'mission') return 'Mission reward';
  if (row.kind === 'override') return `Team override · ${row.inviteeName ?? 'member'}`;
  if (row.kind === 'referee') return 'Welcome reward';
  return `Reward · ${row.inviteeName ?? 'friend'}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm },
  headerWrap: { gap: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  balanceCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 2 },
  balanceLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  balanceValue: { ...Typography.displayLg, color: Colors.onPrimary, fontWeight: '800' as const },
  balanceActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: Radius.full },
  actionPrimary: { backgroundColor: Colors.onPrimaryContainer },
  actionGhost: { backgroundColor: Colors.surfaceContainerLowest },
  actionText: { ...Typography.labelMd, color: Colors.onSurface },
  actionTextPrimary: { color: Colors.onPrimary },
  quickRow: { flexDirection: 'row', gap: Spacing.sm },
  quickChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingVertical: 10 },
  quickChipText: { ...Typography.labelMd, color: Colors.onSurface },
  filterWrap: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAmount: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  rowAmountNeg: { color: Colors.error },
});
