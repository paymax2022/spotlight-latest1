import React, { useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { useContests } from '@/features/voting/hooks/useContests';
import ContestCard from '@/features/voting/components/ContestCard';
import NoContestsState from '@/features/voting/components/NoContestsState';
import SelectField from '@/components/SelectField';
import {
  CONTEST_FILTER_OPTIONS,
  DEFAULT_CONTEST_FILTER,
  contestFilterApiStatus,
  contestFilterFromLabel,
  contestFilterLabel,
  filterContestsByStatus,
  type ContestFilter,
} from '@/features/voting/utils/contestFilter';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function ContestListScreen() {
  const [statusFilter, setStatusFilter] = useState<ContestFilter>(DEFAULT_CONTEST_FILTER);
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, refetch, isRefetching } = useContests(
    { status: contestFilterApiStatus(statusFilter) },
  );

  const filtered = filterContestsByStatus(data ?? [], statusFilter).filter((c) =>
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

      {/* Status filter dropdown: Active (default) / Closed */}
      <View style={styles.filterWrap}>
        <SelectField
          value={contestFilterLabel(statusFilter)}
          options={CONTEST_FILTER_OPTIONS}
          onChange={(label) => setStatusFilter(contestFilterFromLabel(label))}
          searchable={false}
        />
      </View>

      {isLoading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : isError ? (
        // A fetch failure used to fall straight into ListEmptyComponent, which
        // reads as "no contests exist yet" rather than "we couldn't reach the
        // server" — the two need different messages and only one is retriable.
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Could not load contests</Text>
          <Text style={styles.emptySub}>Check your connection and try again.</Text>
          <Pressable onPress={() => refetch()} style={styles.filterChip}>
            <Text style={styles.filterLabel}>Retry</Text>
          </Pressable>
        </View>
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
            search.trim() ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptySub}>Try a different search.</Text>
              </View>
            ) : (
              <NoContestsState
                compact
                title={statusFilter === 'closed' ? 'No closed contests yet…' : 'No live contests right now…'}
                message={
                  statusFilter === 'closed'
                    ? 'Nothing has finished voting yet. Pull down to refresh once a contest wraps up.'
                    : 'Keep calm, light a fire and pull down to refresh. New Spotlight contests open here.'
                }
              />
            )
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
  filterWrap: { paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
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
