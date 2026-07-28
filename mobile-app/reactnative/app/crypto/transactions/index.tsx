import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import CryptoTransactionRow from '@/features/crypto/components/CryptoTransactionRow';
import { useCryptoTransactions } from '@/features/crypto/hooks/useCrypto';

type Filter = 'all' | 'buy' | 'sell';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'buy', label: 'Buys' },
  { value: 'sell', label: 'Sells' },
];

export default function CryptoTransactionsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const txns = useCryptoTransactions(filter === 'all' ? undefined : filter);
  const list = txns.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Crypto activity" subtitle="Buys & sells" />

      <View style={styles.filterWrap}>
        <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {txns.isLoading ? (
        <StateView kind="loading" message="Loading activity…" />
      ) : txns.isError ? (
        <StateView kind="error" title="Couldn't load activity" message="Please check your connection and try again." actionLabel="Retry" onAction={() => txns.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Receipt" title="No transactions yet" message="Your buys and sells will appear here." actionLabel="Explore assets" onAction={() => router.push('/crypto/assets')} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            {list.map((t, i, arr) => (
              <View key={t.id}>
                <CryptoTransactionRow tx={t} onPress={() => router.push(`/crypto/transactions/${t.id}`)} />
                {i < arr.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { marginVertical: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
