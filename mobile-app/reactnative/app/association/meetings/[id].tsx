import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, Video, Users, FileText, Clock, CheckCircle2, ScrollText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import QrCodeView from '@/components/QrCodeView';
import { useMeeting, useRsvpMeeting, useCheckInMeeting } from '@/features/association/hooks/useEngagement';
import { formatDateTime } from '@/features/association/utils/associationFormatters';
import { MEETING_MODE_LABEL } from '@/features/association/constants/engagement.constants';
import type { RsvpStatus } from '@/features/association/types/engagement.types';

const RSVP_OPTIONS: { value: Exclude<RsvpStatus, null>; label: string }[] = [
  { value: 'YES', label: 'Going' },
  { value: 'MAYBE', label: 'Maybe' },
  { value: 'NO', label: "Can't" },
];

export default function MeetingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meeting = useMeeting(id);
  const rsvp = useRsvpMeeting();
  const checkIn = useCheckInMeeting();
  const [showQr, setShowQr] = useState(false);

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
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => meeting.refetch()} />
      </SafeAreaView>
    );
  }

  const m = meeting.data;
  const Mode = m.mode === 'PHYSICAL' ? MapPin : Video;
  const current = rsvp.variables?.status ?? m.rsvp;
  const checkedIn = m.checkedIn || checkIn.isSuccess;
  const isPast = m.state === 'PAST';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Meeting" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.modePill}>
          <Mode size={12} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.modeText}>{MEETING_MODE_LABEL[m.mode]}</Text>
        </View>
        <Text style={styles.title}>{m.title}</Text>
        <Text style={styles.when}>{formatDateTime(m.startsAt)}</Text>

        <View style={[styles.infoCard, shadow1]}>
          {m.location ? (
            <View style={styles.infoRow}>
              <MapPin size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.infoText}>{m.location}</Text>
            </View>
          ) : null}
          <View style={styles.infoRow}>
            <Users size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.infoText}>{m.attendeeCount} attending</Text>
          </View>
        </View>

        <Text style={styles.body}>{m.description}</Text>

        {/* RSVP */}
        {!isPast ? (
          <>
            <Text style={styles.sectionTitle}>Will you attend?</Text>
            <View style={styles.rsvpRow}>
              {RSVP_OPTIONS.map((opt) => {
                const active = current === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => rsvp.mutate({ id: m.id, status: opt.value })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`RSVP ${opt.label}`}
                    style={[styles.rsvpBtn, active && styles.rsvpBtnActive]}
                  >
                    {active ? <CheckCircle2 size={15} color={Colors.onPrimary} strokeWidth={2.2} /> : null}
                    <Text style={[styles.rsvpBtnText, active && styles.rsvpBtnTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Agenda */}
        <Text style={styles.sectionTitle}>Agenda</Text>
        <View style={[styles.infoCard, shadow1]}>
          {m.agenda.map((item, i) => (
            <View key={item.id} style={[styles.agendaRow, i > 0 && styles.agendaDivider]}>
              <View style={styles.agendaNum}><Text style={styles.agendaNumText}>{item.order}</Text></View>
              <Text style={styles.agendaTitle}>{item.title}</Text>
              {item.durationMin ? (
                <View style={styles.durChip}>
                  <Clock size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.durText}>{item.durationMin}m</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* Documents */}
        {m.documents.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Documents</Text>
            <View style={styles.gap8}>
              {m.documents.map((d) => (
                <Pressable key={d.id} style={[styles.docRow, shadow1]} accessibilityRole="button" accessibilityLabel={`Open ${d.name}`}>
                  <FileText size={18} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.docName} numberOfLines={1}>{d.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {/* Minutes (past meetings) */}
        {isPast && m.minutesPublished ? (
          <Pressable style={[styles.minutesRow, shadow1]} accessibilityRole="button" accessibilityLabel="View minutes">
            <ScrollText size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.minutesText}>View published minutes</Text>
          </Pressable>
        ) : isPast && !m.minutesPublished ? (
          <Pressable style={[styles.minutesRow, shadow1]} onPress={() => router.push('/association/ai-notes/new')} accessibilityRole="button" accessibilityLabel="Generate AI minutes">
            <ScrollText size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.minutesText}>Generate AI minutes from recording</Text>
          </Pressable>
        ) : null}

        {/* Check-in QR */}
        {showQr ? (
          <View style={styles.qrWrap}>
            <QrCodeView payload={m.attendanceCode} size={180} />
            <Text style={styles.qrHint}>Show this code to the meeting host to confirm attendance</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Footer: check-in */}
      {!isPast ? (
        <View style={styles.footer}>
          {checkedIn ? (
            <View style={styles.checkedRow}>
              <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2.4} />
              <Text style={styles.checkedText}>You're checked in</Text>
            </View>
          ) : (
            <View style={styles.footerBtns}>
              <PrimaryButton label="Show QR" variant="secondary" fullWidth={false} style={styles.footerBtn} onPress={() => setShowQr((s) => !s)} />
              <PrimaryButton label="Check in" fullWidth={false} style={styles.footerBtn} loading={checkIn.isPending} onPress={() => checkIn.mutate(m.id)} />
            </View>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 130, gap: Spacing.md },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3, alignSelf: 'flex-start' },
  modeText: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  when: { ...Typography.labelLg, color: Colors.secondary },
  infoCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  infoText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  rsvpRow: { flexDirection: 'row', gap: Spacing.sm },
  rsvpBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  rsvpBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rsvpBtnText: { ...Typography.labelMd, color: Colors.onSurface },
  rsvpBtnTextActive: { color: Colors.onPrimary },
  agendaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  agendaDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  agendaNum: { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  agendaNumText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  agendaTitle: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  durChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  durText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  gap8: { gap: Spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  docName: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  minutesRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md },
  minutesText: { ...Typography.labelMd, color: Colors.primary, flex: 1 },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  qrHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: Spacing.lg },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  footerBtns: { flexDirection: 'row', gap: Spacing.sm },
  footerBtn: { flex: 1 },
  checkedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  checkedText: { ...Typography.labelMd, color: Colors.teal },
});
