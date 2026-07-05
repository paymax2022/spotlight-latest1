import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useWatchlist, useToggleWatch } from '@/features/fractionalre/hooks';
import OpportunityCard from '@/features/fractionalre/components/OpportunityCard';
import type { OfferingSummary } from '@/features/fractionalre/types';

export default function WatchlistScreen() {
  const watchlist = useWatchlist();
  const toggleWatch = useToggleWatch();
  const onToggle = (o: OfferingSummary) => toggleWatch.mutate({ id: o.id, watched: o.watched });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Watchlist" />
      {watchlist.isLoading ? (
        <StateView kind="loading" message="Loading watchlist…" />
      ) : (watchlist.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="Nothing watched yet" message="Tap the heart on an opportunity to save it here." icon="Heart" />
      ) : (
        <FlatList
          data={watchlist.data}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <OpportunityCard offering={item} onToggleWatch={onToggle} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md },
});
