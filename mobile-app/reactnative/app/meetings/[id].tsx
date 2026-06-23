import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Clock, MapPin, User, FileText, CheckCircle2, ListChecks } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MetricBar from '@/features/visitor/components/MetricBar';
import { MEETING_MODE_META, MEETING_STATUS_LABELS, MeetingColors, RSVP_META } from '@/features/meetings/constants/meetings.constants';
import { derivedStatus, formatMeetingWhen, timeRange, totalRsvp } from '@/features/meetings/utils/meetingsFormatters';
import { useMeeting, useMeetingMinutes, useRsvp } from '@/features/meetings/hooks/useMeetings';
import type { RsvpResponse } from '@/features/meetings/types/meetings.types';

const RSVP_ORDER: RsvpResponse[] = ['yes', 'maybe', 'no'];

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meeting = useMeeting(id ?? '');
  const minutes = useMeetingMinutes(id ?? '');
  const rsvp = useRsvp();

  if (meeting.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Meeting" />
        <StateView kind="loading" message="Loading meeting…" />
      </SafeAreaView>
    );
  }
  if (meeting.isError || !meeting.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Meeting" />
        <StateView kind="error" title="Meeting unavailable" message="We couldn't load this meeting." actionLabel="Retry" onAction={() => meeting.refetch()} />
      </SafeAreaView>
    );
  }

  const m = meeting.data;
  const status = derivedStatus(m);
  const modeMeta = MEETING_MODE_META[m.mode];
  const ended = status === 'ended';
  const max = Math.max(1, m.rsvpCounts.yes, m.rsvpCounts.maybe, m.rsvpCounts.no);
  const statusColor = status === 'live' ? MeetingColors.live : status === 'cancelled' ? MeetingColors.cancelled : status === 'ended' ? MeetingColors.ended : MeetingColors.scheduled;
  const statusBg = status === 'live' ? MeetingColors.liveBg : status === 'cancelled' ? MeetingColors.cancelledBg : status === 'ended' ? MeetingColors.endedBg : MeetingColors.scheduledBg;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Meeting"
        rightSlot={
          <View style={[styles.chip, { backgroundColor: statusBg }]}>
            {status === 'live' ? <View style={[styles.dot, { backgroundColor: statusColor }]} /> : null}
            <Text style={[styles.chipText, { color: statusColor }]}>{MEETING_STATUS_LABELS[status]}</Text>
          </View>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{m.title}</Text>

        <View style={styles.card}>
          <Row icon={<Clock size={16} color={Colors.onSurfaceVariant} />} label="When" value={`${formatMeetingWhen(m.startsAt)} · ${timeRange(m.startsAt, m.endsAt)}`} />
          <Row icon={<MapPin size={16} color={Colors.onSurfaceVariant} />} label="Where" value={`${modeMeta.label}${m.location ? ` · ${m.location}` : ''}`} />
          <Row icon={<User size={16} color={Colors.onSurfaceVariant} />} label="Organizer" value={m.createdByName ?? 'Estate'} />
        </View>

        {m.agenda ? (
          <View style={styles.card}>
            <View style={styles.cardHead}><FileText size={16} color={Colors.onSurfaceVariant} /><Text style={styles.cardTitle}>Agenda</Text></View>
            <Text style={styles.agenda}>{m.agenda}</Text>
          </View>
        ) : null}

        {/* RSVP */}
        {!ended && status !== 'cancelled' ? (
          <>
            <Text style={styles.sectionLabel}>Will you attend?</Text>
            <View style={styles.rsvpRow}>
              {RSVP_ORDER.map((r) => {
                const selected = m.myRsvp === r;
                const meta = RSVP_META[r];
                return (
                  <Pressable
                    key={r}
                    onPress={() => rsvp.mutate({ meetingId: m.id, response: r })}
                    disabled={rsvp.isPending}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.rsvpBtn, selected && { backgroundColor: meta.color, borderColor: meta.color }]}
                  >
                    {selected ? <CheckCircle2 size={16} color={Colors.onPrimary} strokeWidth={2} /> : null}
                    <Text style={[styles.rsvpBtnText, selected ? { color: Colors.onPrimary } : { color: meta.color }]}>{meta.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* RSVP breakdown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Responses · {totalRsvp(m)}</Text>
          <MetricBar label="Going" value={m.rsvpCounts.yes} max={max} color={MeetingColors.live} />
          <MetricBar label="Maybe" value={m.rsvpCounts.maybe} max={max} color={RSVP_META.maybe.color} />
          <MetricBar label="Can't" value={m.rsvpCounts.no} max={max} color={Colors.error} />
        </View>

        {/* Minutes */}
        {ended ? (
          minutes.data ? (
            <View style={styles.card}>
              <View style={styles.cardHead}><ListChecks size={16} color={Colors.onSurfaceVariant} /><Text style={styles.cardTitle}>Minutes & decisions</Text></View>
              <Text style={styles.agenda}>{minutes.data.content}</Text>
              {minutes.data.decisions.map((d, i) => (
                <View key={i} style={styles.decisionRow}>
                  <CheckCircle2 size={14} color={MeetingColors.live} strokeWidth={2} />
                  <Text style={styles.decisionText}>{d}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.card}><Text style={styles.agenda}>Minutes have not been published yet.</Text></View>
          )
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>{icon}<Text style={styles.rowLabelText}>{label}</Text></View>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  agenda: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 84 },
  rowLabelText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  rsvpRow: { flexDirection: 'row', gap: Spacing.sm },
  rsvpBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  rsvpBtnText: { ...Typography.labelMd },
  decisionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  decisionText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
