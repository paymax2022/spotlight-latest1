import React, { useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Search, X, SlidersHorizontal } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useContestants } from '@/features/voting/hooks/useContestants';
import { useVotingRealtime } from '@/features/voting/hooks/useVotingRealtime';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import ContestantCard from '@/features/voting/components/ContestantCard';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function ContestantGridScreen() {
  const { contestId } = useLocalSearchParams<{ contestId: string }>();
  const [search, setSearch] = useState('');

  const { data: contest } = useContestDetails(contestId ?? '');
  const { data, isLoading, refetch, isRefetching } = useContestants(contestId ?? '', { search });
  // Live: an admin approving an entry adds a contestant here without a reload.
  useVotingRealtime(contestId);

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
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <X size={16} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={data ?? []}
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
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No contestants found</Text>
              <Text style={styles.emptySub}>
                {search ? 'Try a different search.' : 'No contestants have been added to this contest yet.'}
              </Text>
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
  loader:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:    { paddingHorizontal: Spacing.containerMargin, paddingBottom: 100 },
  row:     { gap: Spacing.sm, marginBottom: Spacing.sm },
  empty:   { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  emptySub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
