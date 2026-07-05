import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import ActivityRow from '@/features/social/components/ActivityRow';
import { useActivity } from '@/features/social/hooks';
import { SocialColors } from '@/features/social/constants/social.constants';
import type { ActivityKind } from '@/features/social/types';

type Filter = 'all' | 'sent' | 'received' | 'request';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'received', label: 'Received' },
  { value: 'request', label: 'Requests' },
];

export default function Activity() {
  const activity = useActivity();
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const list = activity.data ?? [];
    if (filter === 'all') return list;
    if (filter === 'request') return list.filter((a) => a.kind === 'request');
    return list.filter((a) => a.kind === (filter as ActivityKind));
  }, [activity.data, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Activity" />
      <View style={styles.filterWrap}>
        <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} scrollable />
      </View>

      {activity.isLoading ? (
        <StateView kind="loading" message="Loading activity…" />
      ) : activity.isError ? (
        <StateView kind="error" title="Couldn't load activity" actionLabel="Retry" onAction={() => activity.refetch()} />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" title="Nothing here yet" message="Transactions matching this filter will show up here." icon="Send" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            {filtered.map((a) => (
              <ActivityRow key={a.id} item={a} onPress={() => {
                if (a.kind === 'split') router.push('/social/split/create');
                else if (a.kind === 'pool') router.push('/social/pool/create');
              }} />
            ))}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin },
  card: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.xs, ...shadow1 },
});
