import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronRight, MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import EventsTabBar from '@/features/events/components/EventsTabBar';
import StatusPill, { pillFor } from '@/features/events/components/StatusPill';
import CommerceNotice from '@/features/events/components/CommerceNotice';
import { useMyCases } from '@/features/events/hooks';
import { SUPPORT_KIND_LABEL } from '@/features/events/support';
import { EventColors, SUPPORT_STATE_BADGE, EVENTS_COMMERCE_ENABLED } from '@/features/events/constants/events.constants';
import type { SupportCase } from '@/features/events/types';

type Filter = '' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
const FILTERS: { value: Filter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SupportCases() {
  const [status, setStatus] = useState<Filter>('');
  const { data, isLoading, isError, refetch, isRefetching } = useMyCases(status);

  const newCase = () => router.push('/events/support/new');

  if (!EVENTS_COMMERCE_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Support" backFallback="/events/orders" />
        <CommerceNotice />
        <EventsTabBar />
      </SafeAreaView>
    );
  }

  const cases = Array.isArray(data) ? data : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Support"
        subtitle="Your event help requests"
        backFallback="/events/orders"
        rightSlot={
          <Pressable onPress={newCase} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Open a support case">
            <Plus size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <View style={{ marginBottom: Spacing.md }}>
        <SegmentedControl options={FILTERS} value={status} onChange={setStatus} scrollable />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading your cases…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load support cases" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : cases.length === 0 ? (
        <StateView kind="empty" title={status ? 'Nothing in this view' : 'No support cases'} message="Problems with a ticket, payment, refund or check-in can be raised with the organiser and our desk here." icon="LifeBuoy" actionLabel="Open a case" onAction={newCase} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          {cases.map((c) => <CaseRow key={c.id} c={c} />)}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
      <EventsTabBar />
    </SafeAreaView>
  );
}

function CaseRow({ c }: { c: SupportCase }) {
  const pill = pillFor(SUPPORT_STATE_BADGE, c.status);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/events/support/[caseId]', params: { caseId: c.id } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel={`${c.subject}, ${pill?.label ?? c.status}`}
    >
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{c.subject}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {SUPPORT_KIND_LABEL[c.kind] ?? c.kind}{c.event_title ? ` · ${c.event_title}` : ''}
          </Text>
        </View>
        {pill ? <StatusPill {...pill} /> : null}
      </View>
      {c.last_message ? <Text style={styles.preview} numberOfLines={2}>{c.last_message.author_name ? `${c.last_message.author_name}: ` : ''}{c.last_message.body}</Text> : null}
      <View style={styles.rowBottom}>
        <MessageSquare size={13} color={EventColors.muted} strokeWidth={1.8} />
        <Text style={styles.meta}>{c.reply_count} repl{c.reply_count === 1 ? 'y' : 'ies'} · updated {when(c.updated_at)}</Text>
        <ChevronRight size={16} color={EventColors.muted} style={{ marginLeft: 'auto' }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  iconBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  row: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  rowTop: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  preview: { ...Typography.bodySm, color: Colors.onSurface },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { ...Typography.caption, color: EventColors.muted },
});
