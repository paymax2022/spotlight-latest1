import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronRight, CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import ScheduledStatusChip from '@/features/mobility/components/ScheduledStatusChip';
import { useScheduledList } from '@/features/mobility/hooks/useScheduled';
import { SCHEDULED_MODE_META, SCHEDULED_ENABLED } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { ScheduledBooking, ScheduledFilter } from '@/features/mobility/api/scheduled.api';

const TABS: { value: ScheduledFilter; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

const errKind = (e: unknown): 'offline' | 'genericError' =>
  (e as { response?: unknown })?.response ? 'genericError' : 'offline';

function modeLabel(mode: ScheduledBooking['mode']): string {
  return SCHEDULED_MODE_META.find((m) => m.value === mode)?.label ?? mode;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ScheduledListScreen() {
  const [tab, setTab] = useState<ScheduledFilter>('upcoming');
  const list = useScheduledList(tab);

  if (!SCHEDULED_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Scheduled trips" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Scheduled trips"
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/scheduled/new')} hitSlop={8} accessibilityLabel="Schedule a new trip">
            <Plus size={22} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
        }
      />

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.value} style={[styles.tab, tab === t.value && styles.tabActive]} onPress={() => setTab(t.value)}>
            <Text style={[styles.tabLabel, tab === t.value && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {list.isLoading ? (
        <StateView kind="loading" message="Loading your scheduled trips…" />
      ) : list.isError ? (
        <MobilityEdgeState kind={errKind(list.error)} actionLabel="Retry" onAction={() => list.refetch()} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <MobilityEdgeState
          kind="empty"
          title={tab === 'upcoming' ? 'No upcoming trips' : 'No past trips'}
          message={tab === 'upcoming' ? 'Schedule a ride, parcel, airport pickup, or bus seat ahead of time.' : 'Trips you have completed or cancelled will show up here.'}
          actionLabel={tab === 'upcoming' ? 'Schedule a trip' : undefined}
          onAction={tab === 'upcoming' ? () => router.push('/mobility/scheduled/new') : undefined}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} tintColor={Colors.primary} />}
        >
          {list.data!.items.map((b) => (
            <Pressable key={b.id} style={[styles.card, shadow1]} onPress={() => router.push(`/mobility/scheduled/${b.id}`)}>
              <View style={styles.cardIcon}><CalendarClock size={20} color={Colors.primary} strokeWidth={2.2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardMode}>{modeLabel(b.mode)}</Text>
                <Text style={styles.cardWhen} numberOfLines={1}>{formatWhen(b.scheduledPickupAt)}</Text>
                <Text style={styles.cardRoute} numberOfLines={1}>
                  {b.pickup?.label ?? '—'}{b.dropoff ? ` → ${b.dropoff.label}` : ''}
                </Text>
                <View style={styles.cardMetaRow}>
                  <ScheduledStatusChip status={b.status} />
                  {b.estimatedFareKobo != null && <Text style={styles.cardFare}>{formatNairaWhole(b.estimatedFareKobo)}</Text>}
                </View>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {tab === 'upcoming' && (list.data?.items.length ?? 0) > 0 && (
        <View style={styles.footer}>
          <PrimaryButton label="Schedule a trip" onPress={() => router.push('/mobility/scheduled/new')} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabs: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  tab: { flex: 1, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  tabActive: { backgroundColor: Colors.primaryFixed },
  tabLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tabLabelActive: { color: Colors.primary, fontWeight: '700' as const },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  cardMode: { ...Typography.labelLg, color: Colors.onSurface },
  cardWhen: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  cardRoute: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  cardFare: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
