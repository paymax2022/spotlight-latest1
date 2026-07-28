import React from 'react';
import { FlatList, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BadgeCheck, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMatchableCampaigns } from '@/features/crowdfunding/hooks/useCsr';
import { formatNairaCompact, progressPct } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CsrBrowseScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useMatchableCampaigns();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Impact campaigns" subtitle="Choose a verified cause to match" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load campaigns" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const pct = progressPct(item.raisedKobo, item.goalKobo);
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/crowdfunding/csr/campaign/${item.id}`)} accessibilityRole="button">
                <View style={styles.thumb}>
                  {item.coverImage ? <Image source={{ uri: item.coverImage }} style={styles.thumbImg} /> : null}
                </View>
                <View style={styles.body}>
                  <View style={styles.tagRow}>
                    <Text style={styles.tag}>{item.impactTag}</Text>
                    {item.verified && <BadgeCheck size={13} color={Colors.secondary} strokeWidth={2.2} />}
                  </View>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
                  <Text style={styles.meta}>{formatNairaCompact(item.raisedKobo)} raised · {item.contributorCount.toLocaleString('en-NG')} backers</Text>
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          }}
          ListEmptyComponent={<StateView kind="empty" icon="HandCoins" title="No campaigns available" message="Check back soon for matchable impact campaigns." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 60, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  body: { flex: 1, gap: 5 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  track: { height: 5, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
