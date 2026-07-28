import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, Share, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Search, Download } from 'lucide-react-native';
import { formatMoneyObj, formatDateTime } from '@/features/fx/utils/fxFormatters';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedTabs from '@/components/SegmentedControl';
import TransactionRow from '@/features/fx/components/TransactionRow';
import { useTransactions } from '@/features/fx/hooks/useFx';
import type { TxType } from '@/features/fx/types/fx.types';

type TypeFilter = 'all' | TxType;

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'conversion', label: 'Conversions' },
  { value: 'transfer', label: 'Payouts' },
  { value: 'collection', label: 'Collections' },
];

export default function TransactionsScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const [type, setType] = useState<TypeFilter>((params.type as TypeFilter) || 'all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, refetch } = useTransactions({
    type: type === 'all' ? undefined : type,
    search: search.trim() || undefined,
  });

  const exportStatement = async () => {
    const rows = (data ?? []).map((t) =>
      [t.reference, t.type, t.status, `${t.direction === 'out' ? '-' : '+'}${formatMoneyObj(t.direction === 'out' ? t.source : t.destination)}`, formatDateTime(t.createdAt)].join(','),
    );
    const csv = ['Reference,Type,Status,Amount,Date', ...rows].join('\n');
    try { await Share.share({ message: csv, title: 'FX statement' }); } catch { /* dismissed */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Transactions"
        subtitle="Unified ledger view"
        rightSlot={
          (data ?? []).length > 0 ? (
            <Pressable onPress={exportStatement} hitSlop={8} accessibilityRole="button" accessibilityLabel="Export statement">
              <Download size={20} color={Colors.secondary} strokeWidth={2} />
            </Pressable>
          ) : undefined
        }
      />

      <View style={styles.searchWrap}>
        <Search size={16} color={Colors.outline} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or reference…"
          placeholderTextColor={Colors.outline}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          accessibilityLabel="Search transactions"
        />
      </View>

      <View style={styles.tabs}>
        <SegmentedTabs<TypeFilter> scrollable value={type} onChange={setType} options={TYPE_OPTIONS} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading transactions…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load transactions" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="ReceiptText"
          title={search ? 'No matches' : 'No transactions yet'}
          message={search ? `Nothing matches "${search}".` : 'Your conversions, payouts and collections will appear here.'}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <View>
              <TransactionRow tx={item} onPress={() => router.push(`/fx/transactions/${item.id}`)} />
              {index < (data?.length ?? 0) - 1 ? <View style={styles.divider} /> : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, height: 48,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  tabs: { marginTop: Spacing.md, marginBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
