// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { fetchContestants } from '@/api/voting.api';
import { ContestantCard } from '@/components/voting/ContestantCard';
import { GlassCard } from '@/components/voting/GlassCard';
import { GLASS_BORDER, votingColors, votingSpacing, votingTypography } from '@/theme/voting';

export default function ContestantsScreen() {
  const { id: contestId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [search, setSearch] = useState('');

  const contestants = useQuery({
    queryKey: ['contestants', contestId],
    queryFn: () => fetchContestants(contestId),
  });

  const list = (contestants.data ?? []).filter((c) =>
    search ? c.name.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md,
          paddingHorizontal: votingSpacing.margin, paddingVertical: votingSpacing.md,
          borderBottomWidth: 1, borderBottomColor: GLASS_BORDER,
        }}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={votingColors.onSurface} />
        </Pressable>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface, flex: 1 }]}>Contestants</Text>
        <Pressable onPress={() => router.push(`/contest/${contestId}/leaderboard`)}>
          <Ionicons name="podium-outline" size={22} color={votingColors.gold.DEFAULT} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={contestants.isRefetching} onRefresh={contestants.refetch} tintColor={votingColors.gold.DEFAULT} />}
        contentContainerStyle={{ padding: votingSpacing.margin, gap: votingSpacing.md }}
      >
        {/* Search */}
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: votingSpacing.sm,
            backgroundColor: votingColors.bg.card, borderRadius: 12, borderWidth: 1,
            borderColor: search ? votingColors.indigo.DEFAULT : GLASS_BORDER,
            paddingHorizontal: votingSpacing.md, height: 44,
          }}
        >
          <Ionicons name="search-outline" size={16} color={votingColors.onSurfaceMuted} />
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search contestants..."
            placeholderTextColor={votingColors.onSurfaceMuted}
            style={[votingTypography.bodyMd, { flex: 1, color: votingColors.onSurface }]}
          />
        </View>

        {/* Loading */}
        {contestants.isLoading && (
          <View style={{ alignItems: 'center', paddingVertical: votingSpacing.xxl }}>
            <ActivityIndicator color={votingColors.gold.DEFAULT} size="large" />
          </View>
        )}

        {/* Error */}
        {contestants.isError && !contestants.isLoading && (
          <GlassCard>
            <Text style={[votingTypography.bodyMd, { color: votingColors.error, textAlign: 'center' }]}>Failed to load contestants</Text>
            <Pressable onPress={() => contestants.refetch()} style={{ marginTop: votingSpacing.sm, alignItems: 'center' }}>
              <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>Retry</Text>
            </Pressable>
          </GlassCard>
        )}

        {/* Count */}
        {!contestants.isLoading && (
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
            {list.length} contestants
          </Text>
        )}

        {/* List */}
        {list.map((c) => (
          <ContestantCard
            key={c.id}
            contestant={c}
            compact
            onPress={() => router.push({ pathname: `/contestant/${c.id}`, params: { contestId } })}
          />
        ))}

        {list.length === 0 && (
          <GlassCard>
            <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
              No contestants found
            </Text>
          </GlassCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
