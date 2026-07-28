import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl, { SegmentOption } from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import VideoCard from '@/features/spotlightwealth/components/VideoCard';
import CreatorDisclaimer from '@/features/spotlightwealth/components/CreatorDisclaimer';
import { useVideos } from '@/features/spotlightwealth/hooks/useSpotlight';
import { TOPIC_ORDER, TOPIC_STYLE } from '@/features/spotlightwealth/constants/spotlight.constants';
import type { SpotlightTopic } from '@/features/spotlightwealth/types/spotlight.types';

type Filter = 'all' | SpotlightTopic;

const FILTER_OPTIONS: SegmentOption<Filter>[] = [
  { value: 'all', label: 'All' },
  ...TOPIC_ORDER.map((t) => ({ value: t as Filter, label: TOPIC_STYLE[t].label })),
];

export default function SpotlightVideosScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const videos = useVideos(filter === 'all' ? undefined : filter);
  const list = videos.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Finance videos" subtitle="Creator-led financial education" />

      <View style={styles.filterRow}>
        <SegmentedControl<Filter> options={FILTER_OPTIONS} value={filter} onChange={setFilter} scrollable />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.disclaimer}>
          <CreatorDisclaimer />
        </View>

        {videos.isLoading ? (
          <StateView kind="loading" message="Loading videos…" />
        ) : videos.isError ? (
          <StateView kind="error" title="Couldn't load videos" message="Please check your connection and try again." actionLabel="Retry" onAction={() => videos.refetch()} />
        ) : list.length === 0 ? (
          <StateView kind="empty" icon="Video" title="No videos in this topic" message="Try another topic or check back soon." />
        ) : (
          <View style={styles.grid}>
            {list.map((v) => (
              <VideoCard key={v.id} video={v} variant="list" onPress={() => undefined} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterRow: { paddingVertical: Spacing.sm },
  scroll: { paddingBottom: Spacing.xxl },
  disclaimer: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, marginBottom: Spacing.md },
  grid: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
});
