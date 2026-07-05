import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import StockRow from '@/features/stocks/components/StockRow';
import { useStocks } from '@/features/stocks/hooks/useStocks';
import type { StockAsset } from '@/features/stocks/types/stocks.types';

type Filter = 'all' | 'ngx' | 'us' | 'etf' | 'gainers' | 'losers';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ngx', label: 'NGX' },
  { value: 'us', label: 'US' },
  { value: 'etf', label: 'ETF' },
  { value: 'gainers', label: 'Gainers' },
  { value: 'losers', label: 'Losers' },
];

const isEtf = (a: StockAsset) => a.symbol === 'VOO' || a.name.toLowerCase().includes('etf');

export default function StocksListScreen() {
  const stocks = useStocks();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const list = useMemo(() => {
    let items = stocks.data ?? [];
    const q = query.trim().toLowerCase();
    if (q) items = items.filter((a) => a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q));
    if (filter === 'ngx') items = items.filter((a) => a.exchange === 'NGX');
    if (filter === 'us') items = items.filter((a) => a.exchange === 'NASDAQ' || a.exchange === 'NYSE');
    if (filter === 'etf') items = items.filter(isEtf);
    if (filter === 'gainers') items = [...items].sort((a, b) => b.change24hPct - a.change24hPct);
    if (filter === 'losers') items = [...items].sort((a, b) => a.change24hPct - b.change24hPct);
    return items;
  }, [stocks.data, query, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Stocks" subtitle="Admin-approved markets" />

      <SearchBar placeholder="Search Dangote, Apple, VOO…" value={query} onChangeText={setQuery} />

      <View style={styles.filterWrap}>
        <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} scrollable />
      </View>

      {stocks.isLoading ? (
        <StateView kind="loading" message="Loading markets…" />
      ) : stocks.isError ? (
        <StateView kind="error" title="Couldn't load stocks" message="Please check your connection and try again." actionLabel="Retry" onAction={() => stocks.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No stocks found" message="Try a different search or filter." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            {list.map((a, i, arr) => (
              <View key={a.id}>
                <StockRow asset={a} onPress={() => router.push(`/stocks/asset/${a.symbol}`)} />
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
  filterWrap: { marginBottom: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
