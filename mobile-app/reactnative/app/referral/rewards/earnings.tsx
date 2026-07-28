import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useReferralEarnings } from '@/features/referral/rewards/hooks';
import { formatNaira, formatRate, formatDate, RewardColors } from '@/features/referral/rewards/constants';
import { RewardHeader, Chip } from '@/features/referral/rewards/components';
import type { RewardEntry, RewardStatus } from '@/features/referral/rewards/types';

// PRD §5.1.4 — Earnings History. Chronological reward ledger: date, referred
// user (masked), module, amount, status (Credited/Reversed). Filter by module.
// Exit → Wallet.

const STATUS_META: Record<RewardStatus, { label: string; fg: string; bg: string }> = {
  CREDITED: { label: 'Credited', fg: RewardColors.ok,       bg: RewardColors.okBg },
  PENDING:  { label: 'Pending',  fg: RewardColors.warnText, bg: RewardColors.warnBg },
  REVERSED: { label: 'Reversed', fg: RewardColors.danger,   bg: RewardColors.dangerBg },
};

const MODULE_LABEL: Record<string, string> = {
  bills: 'Bills', marketplace: 'Marketplace', insurance: 'Insurance',
  transport: 'Transport', edtech: 'EdTech', connect: 'Connect',
};

function moduleLabel(m: string): string {
  return MODULE_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
}

export default function EarningsHistory() {
  const { data, isLoading, isError, refetch } = useReferralEarnings();
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  const modules = useMemo(() => {
    const set = new Set((data?.earnings ?? []).map((e) => e.module));
    return ['all', ...Array.from(set)];
  }, [data]);

  const rows = useMemo(() => {
    const all = data?.earnings ?? [];
    return moduleFilter === 'all' ? all : all.filter((e) => e.module === moduleFilter);
  }, [data, moduleFilter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <RewardHeader
        title="Earnings history"
        right={
          <Pressable onPress={() => router.push('/wallet')} hitSlop={8} style={styles.walletBtn} accessibilityRole="button" accessibilityLabel="Go to wallet">
            <Wallet size={19} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load earnings" actionLabel="Retry" onAction={refetch} />
      ) : (data?.earnings ?? []).length === 0 ? (
        <StateView
          kind="empty"
          icon="Gift"
          title="No earnings yet"
          message="You'll see a reward here the first time someone you referred makes a purchase."
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <FlatList
              horizontal
              data={modules}
              keyExtractor={(m) => m}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              renderItem={({ item }) => {
                const on = moduleFilter === item;
                return (
                  <Pressable onPress={() => setModuleFilter(item)} style={[styles.filterChip, on && styles.filterChipOn]} accessibilityRole="button">
                    <Text style={[styles.filterText, on && styles.filterTextOn]}>{item === 'all' ? 'All modules' : moduleLabel(item)}</Text>
                  </Pressable>
                );
              }}
            />
          }
          renderItem={({ item }) => <EarningRow item={item} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={<Text style={styles.emptyFilter}>No {moduleLabel(moduleFilter)} rewards.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

function EarningRow({ item }: { item: RewardEntry }) {
  const meta = STATUS_META[item.status];
  const reversed = item.status === 'REVERSED';
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{moduleLabel(item.module)}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {formatDate(item.created_at)} · {formatRate(item.applied_rate)} of {formatNaira(item.margin_kobo)}
        </Text>
        <Text style={styles.rowMasked} numberOfLines={1}>from referral {item.referred_user_id.slice(-4)}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.amount, reversed && styles.amountReversed]}>
          {reversed ? '−' : '+'}{formatNaira(item.reward_kobo)}
        </Text>
        <Chip label={meta.label} fg={meta.fg} bg={meta.bg} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  walletBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  filterRow: { gap: Spacing.sm, paddingBottom: Spacing.md },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1.5, borderColor: RewardColors.border, backgroundColor: RewardColors.surface },
  filterChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontWeight: '600' },
  filterTextOn: { color: Colors.onPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: RewardColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: RewardColors.border, padding: Spacing.md },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  rowMasked: { ...Typography.caption, color: Colors.outline, marginTop: 1 },
  rowRight: { alignItems: 'flex-end', gap: Spacing.xs },
  amount: { ...Typography.labelLg, color: RewardColors.ok, fontWeight: '800' },
  amountReversed: { color: RewardColors.danger, textDecorationLine: 'line-through' },
  emptyFilter: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.xl },
});
