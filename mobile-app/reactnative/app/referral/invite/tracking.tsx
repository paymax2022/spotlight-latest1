import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { StateBadge } from '@/features/referral/components';
import type { BadgeTone } from '@/features/referral/components/StateBadge';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useTrackedInvitees } from '@/features/referral/invite/hooks';
import type { TrackedInvitee, FunnelStage } from '@/features/referral/invite/types';

// M-INV-07 — Invite tracking: per-invitee status clicked → signed up → activated.
const STAGE_META: Record<FunnelStage, { label: string; tone: BadgeTone; step: number }> = {
  invited: { label: 'Invited', tone: 'neutral', step: 0 },
  clicked: { label: 'Clicked', tone: 'accent', step: 1 },
  signed_up: { label: 'Signed up', tone: 'accent', step: 2 },
  kyc: { label: 'KYC done', tone: 'warn', step: 3 },
  activated: { label: 'Activated', tone: 'ok', step: 4 },
};

type Filter = 'all' | 'pending' | 'activated';

export default function TrackingScreen() {
  const { data, isLoading, isError, refetch } = useTrackedInvitees();
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (filter === 'activated') return list.filter((t) => t.stage === 'activated');
    if (filter === 'pending') return list.filter((t) => t.stage !== 'activated');
    return list;
  }, [data, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invite tracking" />
      {isLoading ? (
        <StateView kind="loading" message="Loading your invites…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Users" title="No invites yet" message="Invite friends and follow each one from click to activation here." actionLabel="Invite friends" onAction={() => router.replace('/referral/(tabs)/invite')} />
      ) : (
        <>
          <View style={styles.filterWrap}>
            <SegmentedControl<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'pending', label: 'In progress' },
                { value: 'activated', label: 'Activated' },
              ]}
            />
          </View>
          {filtered.length === 0 ? (
            <StateView kind="empty" icon="Users" title="Nothing here" message="No invitees in this filter yet." />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(t) => t.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => <InviteeRow item={item} />}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

function InviteeRow({ item }: { item: TrackedInvitee }) {
  const meta = STAGE_META[item.stage];
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.sub}>via {item.channel} · {relativeTime(item.lastActivityAt)}</Text>
        </View>
        <StateBadge label={meta.label} tone={meta.tone} />
      </View>

      {/* Funnel rail clicked → signed up → activated */}
      <View style={styles.funnel}>
        {[1, 2, 3, 4].map((s) => (
          <View key={s} style={[styles.funnelSeg, s <= meta.step ? styles.funnelOn : styles.funnelOff]} />
        ))}
      </View>
      <View style={styles.funnelLabels}>
        <Text style={styles.funnelLabel}>Clicked</Text>
        <Text style={styles.funnelLabel}>Signed up</Text>
        <Text style={styles.funnelLabel}>KYC</Text>
        <Text style={styles.funnelLabel}>Activated</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.earned}>{item.earnedKobo > 0 ? `Earned ${formatNaira(item.earnedKobo)}` : 'No earnings yet'}</Text>
        {item.nudgeable && item.stage !== 'activated' && (
          <Pressable style={styles.nudgeBtn} onPress={() => router.push({ pathname: '/referral/invite/nudge', params: { id: item.id, name: item.name } })} accessibilityRole="button">
            <Bell size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.nudgeText}>Nudge</Text>
            <ChevronRight size={14} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  funnel: { flexDirection: 'row', gap: 4 },
  funnelSeg: { flex: 1, height: 6, borderRadius: Radius.full },
  funnelOn: { backgroundColor: Colors.primary },
  funnelOff: { backgroundColor: Colors.surfaceContainerHigh },
  funnelLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  funnelLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, textAlign: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  earned: { ...Typography.labelMd, color: Colors.onSurface },
  nudgeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full },
  nudgeText: { ...Typography.labelMd, color: Colors.primary },
});
