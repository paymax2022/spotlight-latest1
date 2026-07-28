import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { usePolicies } from '@/features/insurance/hooks';
import { PolicyCard } from '@/features/insurance/components';
import { Spacing } from '@/constants/spacing';
import type { Policy } from '@/features/insurance/types';

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'all', label: 'All' },
] as const;

type Filter = (typeof FILTERS)[number]['value'];

const ATTENTION: Policy['state'][] = ['RENEWAL_DUE', 'LAPSED', 'BIND_FAILED', 'PENDING_PAYMENT'];

export default function PolicyWallet() {
  const policies = usePolicies();
  const [filter, setFilter] = useState<Filter>('active');

  const filtered = useMemo(() => {
    const all = policies.data ?? [];
    if (filter === 'all') return all;
    if (filter === 'attention') return all.filter((p) => ATTENTION.includes(p.state));
    return all.filter((p) => p.state === 'ACTIVE' || p.state === 'RENEWAL_DUE');
  }, [policies.data, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My policies" subtitle="Your protection wallet" />

      <View style={styles.filterWrap}>
        <SegmentedControl options={FILTERS as any} value={filter} onChange={(v) => setFilter(v as Filter)} />
      </View>

      {policies.isLoading ? (
        <StateView kind="loading" message="Loading your policies…" />
      ) : policies.isError ? (
        <StateView kind="error" title="Couldn't load policies" message="Check your connection and try again." actionLabel="Retry" onAction={() => policies.refetch()} />
      ) : filtered.length === 0 ? (
        <StateView
          kind="empty"
          title={filter === 'attention' ? 'Nothing needs attention' : 'No policies yet'}
          message={filter === 'attention' ? 'All your cover is in good standing.' : 'Browse cover to protect what matters.'}
          icon="ShieldCheck"
          actionLabel={filter === 'attention' ? undefined : 'Browse cover'}
          onAction={filter === 'attention' ? undefined : () => router.push('/insurance/browse')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {filtered.map((p) => (
            <PolicyCard key={p.id} policy={p} onPress={() => router.push(`/insurance/policies/${p.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  filterWrap: { paddingVertical: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },
});
