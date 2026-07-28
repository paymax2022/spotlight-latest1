import React from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreatorStats, useCreatorWithdrawals } from '@/features/crowdfunding/hooks/useCreator';
import { formatNaira, relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { WithdrawalStatus } from '@/features/crowdfunding/types/crowdfunding.types';

const META: Record<WithdrawalStatus, { label: string; fg: string; bg: string }> = {
  PENDING:    { label: 'Pending',    fg: '#B65A00',                bg: Colors.iconBgOrange },
  PROCESSING: { label: 'Processing', fg: Colors.secondary,         bg: Colors.iconBgBlue },
  APPROVED:   { label: 'Approved',   fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  COMPLETED:  { label: 'Completed',  fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  REJECTED:   { label: 'Rejected',   fg: Colors.error,             bg: Colors.iconBgRed },
};

export default function WithdrawalsScreen() {
  const stats = useCreatorStats();
  const { data, isLoading, isError, refetch, isRefetching } = useCreatorWithdrawals();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Withdrawals" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load withdrawals" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(w) => w.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Available to withdraw</Text>
              <Text style={styles.balanceValue}>{formatNaira(stats.data?.availableBalanceKobo ?? 0)}</Text>
              <Text style={styles.balanceSub}>
                {formatNaira(stats.data?.pendingBalanceKobo ?? 0)} pending · {formatNaira(stats.data?.escrowBalanceKobo ?? 0)} in escrow
              </Text>
              <View style={styles.requestBtn}>
                <PrimaryButton label="Request withdrawal" onPress={() => {}} />
              </View>
              <Text style={styles.note}>Withdrawals require KYC and admin approval. Funds in escrow release per milestone.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = META[item.status];
            return (
              <View style={styles.row}>
                <View style={styles.rowHead}>
                  <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
                  <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
                <Text style={styles.campaign} numberOfLines={1}>{item.campaignTitle}</Text>
                <Text style={styles.meta}>{item.bankLabel} · {item.reference} · {relativeTime(item.requestedAt)}</Text>
                {item.note ? <Text style={[styles.note, item.status === 'REJECTED' && styles.noteError]}>{item.note}</Text> : null}
              </View>
            );
          }}
          ListEmptyComponent={
            <StateView kind="empty" icon="Wallet" title="No withdrawals yet" message="Your withdrawal requests will appear here." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 100, flexGrow: 1 },
  balanceCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg, marginBottom: Spacing.md },
  balanceLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  balanceValue: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: 2 },
  balanceSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  requestBtn: { marginTop: Spacing.md },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  noteError: { color: Colors.error },
  row: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
  campaign: { ...Typography.labelMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
