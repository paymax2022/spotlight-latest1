import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { SlidersHorizontal, ArrowUpDown, Map } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { PropertyCard } from '@/features/stays/components';
import { useSearchStays, useToggleSaved } from '@/features/stays/hooks';
import { isSavedSync } from '@/features/stays/api';
import { useStaysStore } from '@/features/stays/store';
import { SORT_OPTIONS, formatStayRange, formatGuestSummary } from '@/features/stays/constants/stays.constants';

export default function ResultsList() {
  const { query, filter, activeFilterCount } = useStaysStore();
  const results = useSearchStays(query, filter);
  const toggleSave = useToggleSaved();
  const count = activeFilterCount();
  const sortLabel = SORT_OPTIONS.find((s) => s.value === (filter.sort ?? 'top_picks'))?.label;

  // Redirect to the relaxed-criteria screen when nothing matches.
  useEffect(() => {
    if (results.isSuccess && (results.data?.length ?? 0) === 0) {
      router.replace('/stays/empty');
    }
  }, [results.isSuccess, results.data]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={query.destination || 'Search'}
        subtitle={`${formatStayRange(query.checkIn, query.checkOut)} · ${formatGuestSummary(query.guests)}`}
        rightSlot={
          <Pressable onPress={() => router.push('/stays/results/map')} hitSlop={8} accessibilityLabel="Map view">
            <Map size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      <View style={styles.toolbar}>
        <Pressable style={[styles.toolBtn, count > 0 && styles.toolBtnActive]} onPress={() => router.push('/stays/filters')}>
          <SlidersHorizontal size={16} color={count > 0 ? Colors.onPrimary : Colors.onSurface} strokeWidth={2} />
          <Text style={[styles.toolText, count > 0 && styles.toolTextActive]}>Filters{count > 0 ? ` (${count})` : ''}</Text>
        </Pressable>
        <Pressable style={styles.toolBtn} onPress={() => router.push('/stays/sort')}>
          <ArrowUpDown size={16} color={Colors.onSurface} strokeWidth={2} />
          <Text style={styles.toolText}>{sortLabel}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {results.data ? <Text style={styles.count}>{results.data.length} stays</Text> : null}
      </View>

      {results.isLoading ? (
        <StateView kind="loading" message="Searching available stays…" />
      ) : results.isError ? (
        <StateView kind="error" title="Search failed" message="Please try again." actionLabel="Retry" onAction={() => results.refetch()} />
      ) : (
        <FlatList
          data={results.data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <PropertyCard
              property={item}
              saved={isSavedSync(item.id)}
              onToggleSave={() => toggleSave.mutate(item.id)}
              onPress={() => !item.soldOut && router.push(`/stays/property/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  toolBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toolText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  toolTextActive: { color: Colors.onPrimary },
  count: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
});
