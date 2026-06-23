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
import AssetRow from '@/features/crypto/components/AssetRow';
import { useAssets } from '@/features/crypto/hooks/useCrypto';

type Filter = 'all' | 'coins' | 'stablecoins' | 'gainers';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'coins', label: 'Coins' },
  { value: 'stablecoins', label: 'Stablecoins' },
  { value: 'gainers', label: 'Gainers' },
];

const STABLECOINS = ['USDT', 'USDC', 'DAI', 'BUSD'];

export default function CryptoAssetsScreen() {
  const assets = useAssets();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const list = useMemo(() => {
    let items = assets.data ?? [];
    const q = query.trim().toLowerCase();
    if (q) items = items.filter((a) => a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q));
    if (filter === 'stablecoins') items = items.filter((a) => STABLECOINS.includes(a.symbol));
    if (filter === 'coins') items = items.filter((a) => !STABLECOINS.includes(a.symbol));
    if (filter === 'gainers') items = [...items].sort((a, b) => b.change24hPct - a.change24hPct);
    return items;
  }, [assets.data, query, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Crypto assets" subtitle="Admin-approved markets" />

      <SearchBar placeholder="Search Bitcoin, ETH, USDT…" value={query} onChangeText={setQuery} />

      <View style={styles.filterWrap}>
        <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} scrollable />
      </View>

      {assets.isLoading ? (
        <StateView kind="loading" message="Loading markets…" />
      ) : assets.isError ? (
        <StateView kind="error" title="Couldn't load assets" message="Please check your connection and try again." actionLabel="Retry" onAction={() => assets.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No assets found" message="Try a different search or filter." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            {list.map((a, i, arr) => (
              <View key={a.id}>
                <AssetRow asset={a} onPress={() => router.push(`/crypto/asset/${a.symbol}`)} />
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
