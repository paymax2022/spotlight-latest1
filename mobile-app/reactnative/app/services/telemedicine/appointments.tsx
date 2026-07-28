import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarX2, ChevronRight, Video, Phone, MessageCircle } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getAppointments, DEMO_APPOINTMENTS } from '@/api/telemedicine.api';
import { TeleHeader, DoctorAvatar, ConsultStatusBadge } from '@/features/telemedicine/components';
import { IntakeStatusBadge } from '@/features/health/components';
import { useApptIntake } from '@/features/health/hooks';
import type { Appointment, ConsultType } from '@/types/telemedicine';

const TYPE_ICON: Record<ConsultType, typeof Video> = { video: Video, audio: Phone, chat: MessageCircle };
const UPCOMING_STATUSES = ['upcoming', 'confirmed', 'in_progress'];

export default function AppointmentsScreen() {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['tele-appointments'],
    queryFn:  getAppointments,
    placeholderData: DEMO_APPOINTMENTS,
  });

  const filtered = appointments.filter((a) =>
    tab === 'upcoming' ? UPCOMING_STATUSES.includes(a.status) : ['completed', 'cancelled'].includes(a.status),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="My Appointments" />

      <View style={styles.tabs}>
        {(['upcoming', 'past'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'upcoming' ? 'Upcoming' : 'Past'}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {filtered.map((a) => (
            <AppointmentRow key={a.id} appointment={a} />
          ))}
          {filtered.length === 0 && (
            <View style={styles.emptyWrap}>
              <CalendarX2 size={40} color={Colors.outline} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>No {tab} appointments</Text>
              <Text style={styles.emptySub}>
                {tab === 'upcoming' ? 'Book a consultation to see it here.' : 'Your completed consultations will appear here.'}
              </Text>
              {tab === 'upcoming' && (
                <Pressable style={styles.emptyBtn} onPress={() => router.push('/services/telemedicine/doctors')}>
                  <Text style={styles.emptyBtnText}>Find a doctor</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const UPCOMING_FOR_INTAKE = ['upcoming', 'confirmed', 'in_progress'];

function AppointmentRow({ appointment }: { appointment: Appointment }) {
  const TypeIcon = TYPE_ICON[appointment.consultType];
  const dateLabel = new Date(`${appointment.slotDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  // M1 — surface the intake status on the appointment card (upcoming only).
  const showIntake = UPCOMING_FOR_INTAKE.includes(appointment.status);
  const intakeQ = useApptIntake(showIntake ? appointment.id : undefined);
  return (
    <Pressable style={[styles.card, shadow1]} onPress={() => router.push(`/services/telemedicine/appointment/${appointment.id}`)}>
      <DoctorAvatar initials={appointment.doctor.initials} color={appointment.doctor.avatarColor} size={48} />
      <View style={styles.cardBody}>
        <Text style={styles.docName} numberOfLines={1}>{appointment.doctor.name}</Text>
        <Text style={styles.docSpec} numberOfLines={1}>{appointment.doctor.specialties.join(' • ')}</Text>
        <View style={styles.metaRow}>
          <TypeIcon size={13} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.metaText}>{dateLabel} · {appointment.slotTime}</Text>
        </View>
        {showIntake ? (
          <View style={styles.intakeRow}>
            <IntakeStatusBadge status={intakeQ.data?.intake.status} />
          </View>
        ) : null}
      </View>
      <View style={styles.cardRight}>
        <ConsultStatusBadge status={appointment.status} />
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  tabs:         { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md, padding: 4, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow },
  tab:          { flex: 1, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  tabActive:    { backgroundColor: Colors.surfaceContainerLowest, ...shadow1 },
  tabText:      { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tabTextActive:{ color: Colors.primary },
  list:         { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.sm },
  card:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  cardBody:     { flex: 1, gap: 2 },
  docName:      { ...Typography.titleMd, color: Colors.onSurface },
  docSpec:      { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow:      { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  metaText:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  intakeRow:    { flexDirection: 'row', marginTop: 6 },
  cardRight:    { alignItems: 'flex-end', gap: Spacing.sm },
  emptyWrap:    { alignItems: 'center', gap: Spacing.sm, marginTop: 80, paddingHorizontal: Spacing.xl },
  emptyTitle:   { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  emptySub:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  emptyBtn:     { marginTop: Spacing.md, height: 48, paddingHorizontal: Spacing.xl, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { ...Typography.labelLg, color: Colors.onPrimary },
});
