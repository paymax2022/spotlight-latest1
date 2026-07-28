import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Users, ScanLine, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useOrganiserEvents } from '@/features/events/hooks';
import { EventColors, formatNaira, formatNairaCompact, EVENT_STATE_BADGE } from '@/features/events/constants/events.constants';

export default function OrganiserDashboard() {
  const { data, isLoading, isError, refetch } = useOrganiserEvents();

  const totalGross = (data ?? []).reduce((s, e) => s + e.grossKobo, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Organiser"
        rightSlot={
          <Pressable onPress={() => router.push('/events/organiser/create')} hitSlop={10} accessibilityLabel="Create event">
            <Plus size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading dashboard…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load dashboard" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No events yet" message="Create your first event to start selling tickets." icon="Ticket" actionLabel="Create event" onAction={() => router.push('/events/organiser/create')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Gross sales</Text>
              <Text style={styles.summaryValue}>{formatNairaCompact(totalGross)}</Text>
            </View>
          </View>

          <Pressable style={styles.stewardCta} onPress={() => router.push('/events/steward/scan')}>
            <ScanLine size={20} color={Colors.primary} />
            <Text style={styles.stewardText}>Open steward scanner</Text>
            <ChevronRight size={18} color={EventColors.muted} />
          </Pressable>

          {data!.map((stats) => {
            const e = stats.event;
            const pct = stats.ticketsTotal ? Math.round((stats.ticketsSold / stats.ticketsTotal) * 100) : 0;
            const meta = EVENT_STATE_BADGE[e.state] ?? EVENT_STATE_BADGE.APPROVED;
            return (
              <View key={e.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{e.title}</Text>
                  <Text style={[styles.status, { color: meta.color }]}>{e.state}</Text>
                </View>
                <View style={styles.statsRow}>
                  <Stat label="Sold" value={`${stats.ticketsSold}${stats.ticketsTotal ? `/${stats.ticketsTotal}` : ''}`} />
                  <Stat label="Gross" value={formatNaira(stats.grossKobo)} />
                </View>
                {stats.ticketsTotal ? (
                  <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
                ) : null}
                <Pressable style={styles.attendeesLink} onPress={() => router.push({ pathname: '/events/organiser/attendees', params: { eventId: e.id } })}>
                  <Users size={16} color={EventColors.brand} />
                  <Text style={styles.attendeesText}>View attendees</Text>
                  <ChevronRight size={16} color={EventColors.muted} />
                </Pressable>
              </View>
            );
          })}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  summary: { flexDirection: 'row', backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center' },
  summaryItem: { flex: 1, gap: 4 },
  summaryLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  summaryValue: { ...Typography.headlineMd, color: Colors.onPrimary },
  summaryDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: Spacing.md },
  stewardCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  stewardText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, ...shadow1 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  status: { ...Typography.labelSm, fontWeight: '700' as const },
  statsRow: { flexDirection: 'row', gap: Spacing.lg },
  stat: { gap: 2 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: EventColors.muted },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: EventColors.ok },
  attendeesLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  attendeesText: { ...Typography.labelMd, color: EventColors.brand, flex: 1 },
});
