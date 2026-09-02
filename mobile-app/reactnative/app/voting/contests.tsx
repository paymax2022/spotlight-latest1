import React, { useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useContests } from '@/features/voting/hooks/useContests';
import ContestCard from '@/features/voting/components/ContestCard';
import type { ContestStatus } from '@/features/voting/types/voting.types';
import { HomeMenuButton } from '@/components/HomeMenu';

const STATUS_FILTERS: { label: string; value: ContestStatus | 'ALL' }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Live', value: 'LIVE' },
  { label: 'Upcoming', value: 'UPCOMING' },
  { label: 'Closed', value: 'CLOSED' },
];

export default function ContestListScreen() {
  const [statusFilter, setStatusFilter] = useState<ContestStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch, isRefetching } = useContests(
    statusFilter !== 'ALL' ? { status: statusFilter } : undefined,
  );

  const filtered = (data ?? []).filter((c) =>
    search.trim() === '' || c.title.toLowerCase().includes(search.toLowerCase()) || c.category.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/voting')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Contests</Text>
        <HomeMenuButton />
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={16} color={Colors.outline} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search contests…"
          placeholderTextColor={Colors.outline}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <X size={16} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        )}
      </View>

      {/* Status filters */}
      <View style={styles.filtersRow}>
        {STATUS_FILTERS.map((f) => (
          <Pressable
            key={f.value}
            onPress={() => setStatusFilter(f.value)}
            style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]}
          >
            <Text style={[styles.filterLabel, statusFilter === f.value && styles.filterLabelActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ContestCard
              contest={item}
              onPress={() => router.push(`/voting/contest-details?contestId=${item.id}`)}
              style={styles.card}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No contests found</Text>
              <Text style={styles.emptySub}>
                {search ? 'Try a different search.' : 'Check back soon for new Spotlight competitions.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:  { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:    { ...Typography.titleLg, color: Colors.onSurface },
  searchWrap: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              Spacing.sm,
    marginHorizontal: Spacing.containerMargin,
    backgroundColor:  Colors.surfaceContainerLow,
    borderRadius:     Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical:  12,
    marginBottom:     Spacing.sm,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  filtersRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  filterChip: {
    paddingVertical: 7,
    paddingHorizontal: Spacing.md,
    borderRadius:    Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    borderWidth:     1,
    borderColor:     Colors.outlineVariant,
  },
  filterChipActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterLabel:       { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  filterLabelActive: { color: Colors.onPrimary },
  list:   { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100 },
  card:   {},
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  emptySub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
