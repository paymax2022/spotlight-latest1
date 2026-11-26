import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Search, X, SlidersHorizontal } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { useContestants } from '@/features/voting/hooks/useContestants';
import { useVotingRealtime } from '@/features/voting/hooks/useVotingRealtime';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import ContestantCard from '@/features/voting/components/ContestantCard';
import {
  filterRoster,
  hasActiveLocality,
  localityChoices,
  selectLocality,
  type LocalityFilter,
  type LocalityLevel,
} from '@/features/voting/utils/rosterLocality';
import { HomeMenuButton } from '@/components/HomeMenu';

const LEVELS: { level: LocalityLevel; label: string; emptyHint: string }[] = [
  { level: 'state', label: 'State', emptyHint: 'No contestant on this roster has a state.' },
  { level: 'lga', label: 'Local government', emptyHint: 'No local government recorded yet.' },
  { level: 'village', label: 'Village / quarter', emptyHint: 'No village recorded for this area.' },
];

export default function ContestantGridScreen() {
  const { contestId } = useLocalSearchParams<{ contestId: string }>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LocalityFilter>({});
  const [showFilter, setShowFilter] = useState(false);

  const { data: contest } = useContestDetails(contestId ?? '');
  // No `search` in the query params: Go's roster endpoint answers the whole roster and
  // ignores query filters, so the box used to refetch on every keystroke and change
  // nothing. Both the box and the locality panel now narrow the rows in hand.
  const { data, isLoading, isError, refetch, isRefetching } = useContestants(contestId ?? '');
  // Live: an admin approving an entry adds a contestant here without a reload.
  useVotingRealtime(contestId);

  const rows = useMemo(() => filterRoster(data ?? [], filter, search), [data, filter, search]);
  const localityOn = hasActiveLocality(filter);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/voting')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Contestants</Text>
          {contest && <Text style={styles.subtitle} numberOfLines={1}>{contest.title}</Text>}
        </View>
        <HomeMenuButton />
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={16} color={Colors.outline} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search contestants…"
          placeholderTextColor={Colors.outline}
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search contestants"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
            <X size={16} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        )}
        <Pressable
          onPress={() => setShowFilter((v) => !v)}
          accessibilityLabel="Filter by locality"
          accessibilityState={{ selected: showFilter }}
          style={[styles.filterBtn, (localityOn || showFilter) && styles.filterBtnOn]}
        >
          <SlidersHorizontal size={16} color={localityOn || showFilter ? Colors.onPrimary : Colors.onSurfaceVariant} strokeWidth={2} />
          {localityOn && <View style={styles.filterDot} />}
        </Pressable>
      </View>

      {showFilter && (
        <View style={styles.filterPanel}>
          {LEVELS.map(({ level, label, emptyHint }) => {
            const choices = localityChoices(data ?? [], level, filter);
            const picked = String(filter[level] ?? '');
            return (
              <View key={level} style={styles.filterGroup}>
                <Text style={styles.filterLabel}>{label}</Text>
                {choices.length === 0 ? (
                  <Text style={styles.filterHint}>{picked ? 'Nothing at this level under the current choice.' : emptyHint}</Text>
                ) : (
                  <View style={styles.chipWrap}>
                    {choices.map((value) => {
                      const on = picked === value;
                      return (
                        <Pressable
                          key={value}
                          onPress={() => setFilter((prev) => selectLocality(prev, level, value))}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={[styles.chip, on && styles.chipOn]}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{value}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
          {localityOn && (
            <Pressable onPress={() => setFilter({})} accessibilityRole="button" style={styles.clearBtn}>
              <Text style={styles.clearText}>Clear locality filter</Text>
            </Pressable>
          )}
        </View>
      )}

      {isLoading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : isError ? (
        // Same gap as the contest list: an unreachable roster endpoint used to
        // render as "no contestants have been added yet", which is wrong and
        // not retriable from what the voter sees.
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Could not load contestants</Text>
          <Text style={styles.emptySub}>Check your connection and try again.</Text>
          <Pressable onPress={() => refetch()} style={styles.backBtn}>
            <Text style={styles.emptySub}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <ContestantCard
              contestant={item}
              onPress={() => router.push(`/voting/contestant-profile?contestantId=${item.id}&contestId=${contestId}`)}
              onVote={() => router.push(`/voting/contestant-profile?contestantId=${item.id}&contestId=${contestId}`)}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            // A filtered-out roster is not an empty contest. Saying "no contestants
            // have been added" while a filter is on sends the voter to look for a
            // different contest, when the answer is to widen this one.
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{localityOn || search ? 'No contestants match' : 'No contestants found'}</Text>
              <Text style={styles.emptySub}>
                {localityOn
                  ? [filter.state, filter.lga, filter.village].filter(Boolean).join(' · ')
                  : search
                    ? 'Try a different search.'
                    : 'No contestants have been added to this contest yet.'}
              </Text>
              {localityOn && (
                <Pressable onPress={() => setFilter({})} style={styles.clearBtn}>
                  <Text style={styles.clearText}>Clear locality filter</Text>
                </Pressable>
              )}
              {!localityOn && search && (
                <Pressable onPress={() => setSearch('')} style={styles.clearBtn}>
                  <Text style={styles.clearText}>Clear search</Text>
                </Pressable>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, gap: Spacing.sm },
  backBtn:    { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1 },
  title:      { ...Typography.titleLg, color: Colors.onSurface },
  subtitle:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  searchWrap: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              Spacing.sm,
    marginHorizontal: Spacing.containerMargin,
    backgroundColor:  Colors.surfaceContainerLow,
    borderRadius:     Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical:  12,
    marginBottom:     Spacing.md,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  filterBtn: {
    width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainer, position: 'relative',
  },
  filterBtnOn: { backgroundColor: Colors.primary },
  filterDot: { position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.secondary },
  filterPanel: {
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, padding: Spacing.md, gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  filterGroup: { gap: Spacing.xs },
  filterLabel: { ...Typography.labelSm, color: Colors.onSurface },
  filterHint: { ...Typography.caption, color: Colors.outline },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  chipTextOn: { color: Colors.onPrimary },
  clearBtn: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant },
  clearText: { ...Typography.labelSm, color: Colors.primary },
  loader:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:    { paddingHorizontal: Spacing.containerMargin, paddingBottom: 100 },
  row:     { gap: Spacing.sm, marginBottom: Spacing.sm },
  empty:   { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  emptySub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
