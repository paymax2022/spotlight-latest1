// ── Paymax · Admin Console — KYC queue ───────────────────────────────────────
// Identity-review queue, filterable by status, drilling into a case detail.

import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { AdminHeader, ListCard, KycCaseRow } from '@/features/admin/components';
import { useKycQueue } from '@/features/admin/hooks/useAdmin';

type Filter = 'all' | 'pending' | 'review';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'review', label: 'In review' },
];

export default function AdminKycQueueScreen() {
  const queue = useKycQueue();
  const [filter, setFilter] = useState<Filter>('all');

  const list = queue.data ?? [];
  const filtered = useMemo(() => {
    if (filter === 'pending') return list.filter((c) => c.status === 'pending');
    if (filter === 'review') return list.filter((c) => c.status === 'escalated');
    return list;
  }, [list, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="KYC Queue" subtitle="Identity review" />

      <View style={styles.filterWrap}>
        <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {queue.isLoading ? (
        <StateView kind="loading" message="Loading queue…" />
      ) : queue.isError ? (
        <StateView
          kind="error"
          title="Couldn't load the KYC queue"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => queue.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="ShieldCheck" title="Queue is clear" message="No KYC cases awaiting review." />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" icon="Filter" title="Nothing here" message="No cases match this filter." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={queue.isRefetching} onRefresh={() => queue.refetch()} tintColor={Colors.primary} />
          }
        >
          <ListCard flush>
            {filtered.map((c, i, arr) => (
              <KycCaseRow
                key={c.id}
                item={c}
                onPress={() => router.push(`/admin/kyc/${c.id}`)}
                last={i === arr.length - 1}
              />
            ))}
          </ListCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { marginVertical: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },
});
