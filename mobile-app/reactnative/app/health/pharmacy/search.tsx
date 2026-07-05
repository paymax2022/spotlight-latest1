import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import PharmacyProductCard from '@/features/health/components/PharmacyProductCard';
import { useProducts } from '@/features/health/pharmacy/hooks';
import { CATEGORY_OPTIONS } from '@/features/health/pharmacy/constants';
import type { ProductCategory } from '@/features/health/pharmacy/types';

export default function PharmacySearchScreen() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ProductCategory | 'all'>('all');
  const { data, isLoading, isError, refetch } = useProducts({
    q: q || undefined,
    category: category === 'all' ? undefined : category,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Search medicines" />

      <SearchBar placeholder="Search medicines, brands, or pharmacy…" value={q} onChangeText={setQ} autoFocus />

      <View style={styles.filters}>
        <SegmentedControl
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(v) => setCategory(v as ProductCategory | 'all')}
          scrollable
        />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Searching…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't search" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <PharmacyProductCard
                product={item}
                onPress={() => router.push({ pathname: '/health/pharmacy/product/[id]', params: { id: item.id } })}
              />
            </View>
          )}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Pill"
              title="No matches"
              message="Try a different medicine, brand, pharmacy, or category."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filters: { marginBottom: Spacing.md },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 100, gap: Spacing.sm, flexGrow: 1 },
  row: { gap: Spacing.sm },
  cell: { flex: 1, maxWidth: '49%' },
});
