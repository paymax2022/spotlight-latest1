import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { SearchX, SlidersHorizontal } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PropertyCard } from '@/features/stays/components';
import { useRelaxedSearch, useToggleSaved } from '@/features/stays/hooks';
import { isSavedSync } from '@/features/stays/api';
import { useStaysStore } from '@/features/stays/store';

export default function EmptyResults() {
  const { query, resetFilter } = useStaysStore();
  const relaxed = useRelaxedSearch(query, true);
  const toggleSave = useToggleSaved();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="No exact matches" subtitle={query.destination || 'Search'} />

      <View style={styles.banner}>
        <View style={styles.bannerIcon}><SearchX size={22} color={Colors.onSurfaceVariant} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>No stays match all your filters</Text>
          <Text style={styles.bannerSub}>Try relaxing your criteria — here are some nearby options.</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <PrimaryButton label="Adjust filters" variant="secondary" onPress={() => router.replace('/stays/filters')} />
        </View>
        <Pressable style={styles.clearBtn} onPress={() => { resetFilter(); router.replace('/stays/results/list'); }}>
          <SlidersHorizontal size={16} color={Colors.secondary} />
          <Text style={styles.clearText}>Clear all</Text>
        </Pressable>
      </View>

      {relaxed.isLoading ? (
        <StateView kind="loading" message="Finding alternatives…" />
      ) : relaxed.isError ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => relaxed.refetch()} />
      ) : (relaxed.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="SearchX" title="Nothing available" message="Try different dates or a nearby city." />
      ) : (
        <FlatList
          data={relaxed.data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={<Text style={styles.heading}>Suggested for you</Text>}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <PropertyCard
              property={item}
              saved={isSavedSync(item.id)}
              onToggleSave={() => toggleSave.mutate(item.id)}
              onPress={() => router.push(`/stays/property/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  bannerIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bannerSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clearText: { ...Typography.labelMd, color: Colors.secondary },
  heading: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm, textTransform: 'uppercase' },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
});
