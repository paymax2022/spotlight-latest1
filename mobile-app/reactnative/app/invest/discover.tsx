import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StockRow from '@/features/invest/components/StockRow';
import { useStocks } from '@/features/invest/hooks/useInvest';

const SECTORS = ['All', 'Financial Services', 'Telecommunications', 'Industrial Goods', 'Consumer Goods', 'Oil & Gas', 'ETF'];

export default function DiscoverScreen() {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('All');
  const stocks = useStocks(query || undefined, sector === 'All' ? undefined : sector);
  const data = stocks.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Discover stocks" />

      <View style={styles.searchWrap}>
        <Search size={18} color={Colors.onSurfaceVariant} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search company or ticker"
          placeholderTextColor={Colors.onSurfaceVariant}
          style={styles.searchInput}
          autoCapitalize="characters"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <X size={18} color={Colors.onSurfaceVariant} />
          </Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm }}>
        {SECTORS.map((s) => (
          <Pressable key={s} onPress={() => setSector(s)} style={[styles.chip, sector === s && styles.chipActive]}>
            <Text style={[styles.chipText, sector === s && styles.chipTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {stocks.isLoading ? (
        <StateView kind="loading" message="Loading stocks…" />
      ) : stocks.isError ? (
        <StateView kind="error" title="Couldn’t load stocks" message="Please try again." actionLabel="Retry" onAction={() => stocks.refetch()} />
      ) : data.length === 0 ? (
        <StateView kind="empty" title="No stocks found" message="Try a different search or sector." />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }}>
          <View style={[styles.list, shadow1]}>
            {data.map((s, i) => (
              <View key={s.id}>
                {i > 0 && <View style={styles.divider} />}
                <StockRow stock={s} />
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
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, height: 50,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  chips: { marginTop: Spacing.md, marginBottom: Spacing.sm, flexGrow: 0 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
  },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.onPrimary },
  list: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginLeft: 72 },
});
