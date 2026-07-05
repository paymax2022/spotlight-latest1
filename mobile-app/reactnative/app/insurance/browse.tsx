import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useProducts } from '@/features/insurance/hooks';
import { ProductCard } from '@/features/insurance/components';
import { PRODUCT_LINES } from '@/features/insurance/constants/insurance.constants';
import { Spacing } from '@/constants/spacing';
import type { ProductLine } from '@/features/insurance/types';

const FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  ...PRODUCT_LINES.map((l) => ({ value: l.line, label: l.label })),
];

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ line?: string }>();
  const initial = params.line && FILTERS.some((f) => f.value === params.line) ? params.line : 'all';
  const [filter, setFilter] = useState<string>(initial);

  const line = filter === 'all' ? undefined : (filter as ProductLine);
  const products = useProducts(line);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Browse cover" subtitle="Choose a product line" />

      <View style={styles.filterWrap}>
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} scrollable />
      </View>

      {products.isLoading ? (
        <StateView kind="loading" message="Loading products…" />
      ) : products.isError ? (
        <StateView
          kind="error"
          title="Couldn't load products"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => products.refetch()}
        />
      ) : (products.data ?? []).length === 0 ? (
        <StateView kind="empty" title="No products here" message="Try another product line." icon="Umbrella" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {(products.data ?? []).map((p) => (
            <ProductCard
              key={p.code}
              product={p}
              onPress={() => router.push(`/insurance/product/${encodeURIComponent(p.code)}`)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  filterWrap: { paddingVertical: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
});
