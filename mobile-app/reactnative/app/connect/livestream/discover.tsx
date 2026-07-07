import React, { useState } from 'react';
import { View, Text, FlatList, Image, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Radio, Eye, Swords, Mic, Users, Trophy, Play } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useLiveStreams } from '@/features/connect/livestream/hooks';
import type { LiveCategory, LiveStream } from '@/features/connect/livestream/types';

const CATS: { value: LiveCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'music', label: 'Music' },
  { value: 'talk', label: 'Talk' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'dance', label: 'Dance' },
  { value: 'events', label: 'Events' },
];

/** Live discovery grid (PRD §10.6 LV-01..LV-03). */
export default function LiveDiscoverScreen() {
  const [cat, setCat] = useState<LiveCategory>('all');
  const q = useLiveStreams(cat);
  const streams = q.data ?? [];

  function formatIcon(s: LiveStream) {
    if (s.format === 'pk') return <Swords size={12} color={Colors.onPrimary} strokeWidth={2.4} />;
    if (s.format === 'audio') return <Mic size={12} color={Colors.onPrimary} strokeWidth={2.4} />;
    if (s.format === 'multi') return <Users size={12} color={Colors.onPrimary} strokeWidth={2.4} />;
    return <Radio size={12} color={Colors.onPrimary} strokeWidth={2.4} />;
  }

  function renderItem({ item }: { item: LiveStream }) {
    return (
      <Pressable
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`Watch ${item.title} by ${item.hostName}`}
        onPress={() => router.push({ pathname: '/connect/livestream/viewer', params: { id: item.id } })}
      >
        <Image source={{ uri: item.coverUrl }} style={styles.cover} resizeMode="cover" />
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
        <View style={styles.formatBadge}>{formatIcon(item)}</View>
        <View style={styles.viewerBadge}>
          <Eye size={11} color={Colors.onPrimary} strokeWidth={2.2} />
          <Text style={styles.viewerText}>{item.viewerCount.toLocaleString('en-NG')}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <View style={styles.hostRow}>
            <Image source={{ uri: item.hostAvatar }} style={styles.hostAvatar} />
            <Text style={styles.host} numberOfLines={1}>{item.hostName}</Text>
            {item.locationLabel ? <Text style={styles.loc}>· {item.locationLabel}</Text> : null}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Live"
        subtitle="Discover streams happening now"
        rightSlot={
          <Pressable
            hitSlop={10}
            accessibilityLabel="Leaderboard"
            onPress={() => router.push('/connect/livestream/leaderboard')}
          >
            <Trophy size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      <View style={styles.segWrap}>
        <SegmentedControl options={CATS} value={cat} onChange={setCat} scrollable />
      </View>

      <Pressable
        style={styles.replayRow}
        accessibilityRole="button"
        onPress={() => router.push('/connect/livestream/replay')}
      >
        <Play size={15} color={Colors.secondary} strokeWidth={2.4} />
        <Text style={styles.replayText}>Watch replays</Text>
      </Pressable>

      {q.isLoading ? (
        <StateView kind="loading" message="Finding live streams…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load live" message="Check your connection and try again." actionLabel="Retry" onAction={() => q.refetch()} />
      ) : streams.length === 0 ? (
        <StateView kind="empty" icon="Radio" title="No live streams" message="Nothing live in this category right now. Be the first to go live." actionLabel="Go live" onAction={() => router.push('/connect/livestream/broadcaster/preflight')} />
      ) : (
        <FlatList
          data={streams}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.col}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={Colors.primary} />}
        />
      )}

      <Pressable
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Go live"
        onPress={() => router.push('/connect/livestream/broadcaster/preflight')}
      >
        <Radio size={18} color={Colors.onPrimary} strokeWidth={2.4} />
        <Text style={styles.fabText}>Go live</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingVertical: Spacing.sm },
  replayRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  replayText: { ...Typography.labelMd, color: Colors.secondary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 96 },
  col: { gap: Spacing.md },
  card: { flex: 1, marginBottom: Spacing.md, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: ConnectColors.border },
  cover: { width: '100%', aspectRatio: 0.82, backgroundColor: Colors.surfaceContainer },
  liveBadge: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.error, paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.full },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.onPrimary },
  liveText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '800' as const, fontSize: 10 },
  formatBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: ConnectColors.brand, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  viewerBadge: { position: 'absolute', top: 38, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.backdropDark, paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.full },
  viewerText: { ...Typography.labelSm, color: Colors.onPrimary, fontSize: 10 },
  cardBody: { padding: Spacing.sm, gap: 4 },
  title: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hostAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.surfaceContainer },
  host: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flexShrink: 1 },
  loc: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fab: { position: 'absolute', bottom: 24, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ConnectColors.brand, paddingHorizontal: 22, paddingVertical: 14, borderRadius: Radius.full, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  fabText: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '700' as const },
});
