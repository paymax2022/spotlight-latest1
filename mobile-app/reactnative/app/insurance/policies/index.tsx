// ── Protection — policy wallet ───────────────────────────────────────────────
// Real policies from GET /policies. Nothing is synthesised: an empty list means
// the user genuinely holds no cover, and that is what the screen says.
//
// The empty state is the one almost everyone sees today, so it is not a grey box
// with "No data" in it. It explains what a policy wallet is for, what would be
// here, and offers the one action that changes the situation.

import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FolderOpen, ShieldCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  InsuranceErrorState,
  LivePolicyCard,
  PolicyListSkeleton,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { useLivePolicies } from '@/features/insurance/live/hooks';
import { nairaCompact } from '@/features/insurance/live/money';
import type { Policy } from '@/features/insurance/live/types';

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Activating' },
  { value: 'past', label: 'Past' },
] as const;

type Filter = (typeof FILTERS)[number]['value'];

const PAST: Policy['status'][] = ['expired', 'cancelled', 'lapsed'];

export default function PolicyWallet() {
  const policies = useLivePolicies();
  const [filter, setFilter] = useState<Filter>('active');

  const rows = policies.data ?? [];
  const hasAny = rows.length > 0;

  const filtered = useMemo(() => {
    if (filter === 'active') return rows.filter((p) => p.status === 'active');
    if (filter === 'pending') return rows.filter((p) => p.status === 'pending');
    return rows.filter((p) => PAST.includes(p.status));
  }, [rows, filter]);

  const totalCoverKobo = rows
    .filter((p) => p.status === 'active')
    .reduce((s, p) => s + p.sumInsuredKobo, 0);

  // ── Loading ──
  if (policies.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My policies" />
        <PolicyListSkeleton count={3} />
      </SafeAreaView>
    );
  }

  // ── Failed ── (never a fixture fallback — a policy list must be true)
  if (policies.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My policies" />
        <InsuranceErrorState error={policies.error} onRetry={() => policies.refetch()} />
      </SafeAreaView>
    );
  }

  // ── Genuinely empty — the state almost everyone is in ──
  if (!hasAny) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My policies" />
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <FolderOpen size={30} color={InsuranceColors.brand} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>Your policy wallet is empty</Text>
          <Text style={styles.emptyBody}>
            Every policy you buy through Paymax lands here — with its certificate, its renewal date,
            and a claim you can start in two taps. Nothing to dig out of an email.
          </Text>

          <View style={styles.emptyList}>
            <EmptyPoint text="Your certificate, available offline" />
            <EmptyPoint text="A reminder before cover runs out" />
            <EmptyPoint text="Claims filed from the policy itself" />
          </View>

          <PrimaryButton label="Find cover" onPress={() => router.push('/insurance/browse')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My policies"
        subtitle={
          totalCoverKobo > 0 ? `${nairaCompact(totalCoverKobo)} of cover in force` : undefined
        }
      />

      <View style={styles.filterWrap}>
        <SegmentedControl
          options={FILTERS as unknown as { value: Filter; label: string }[]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={policies.isFetching}
            onRefresh={() => policies.refetch()}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.sectionEmpty}>
            <Text style={styles.sectionEmptyTitle}>
              {filter === 'active'
                ? 'No cover in force'
                : filter === 'pending'
                  ? 'Nothing being activated'
                  : 'Nothing here yet'}
            </Text>
            <Text style={styles.sectionEmptyBody}>
              {filter === 'active'
                ? 'None of your policies are currently active. Check the other tabs.'
                : filter === 'pending'
                  ? 'Policies waiting on the insurer appear here.'
                  : 'Expired and cancelled policies are kept here for your records.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <LivePolicyCard
            policy={item}
            onPress={() => router.push(`/insurance/policies/${encodeURIComponent(item.id)}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}

function EmptyPoint({ text }: { text: string }) {
  return (
    <View style={styles.point}>
      <ShieldCheck size={16} color={InsuranceColors.ok} strokeWidth={2.2} />
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  filterWrap: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  list: {
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: 56,
    gap: Spacing.md,
  },

  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  emptyTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  emptyBody: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyList: {
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginVertical: Spacing.xs,
  },
  point: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pointText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },

  sectionEmpty: { paddingTop: Spacing.xl, gap: Spacing.xs, alignItems: 'center' },
  sectionEmptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionEmptyBody: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
});
