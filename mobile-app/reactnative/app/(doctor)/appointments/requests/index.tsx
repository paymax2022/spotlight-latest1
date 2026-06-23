import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Inbox, ChevronRight, Video, Phone, MessageCircle } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useAppointmentRequests } from '@/features/doctor/hooks';
import { QUEUE_PRIORITY_LABELS } from '@/features/doctor/constants';
import type { ConsultType, QueuePriority } from '@/types/doctor.batch1';

const TYPE_ICON: Record<ConsultType, LucideIcon> = { video: Video, audio: Phone, chat: MessageCircle };
const PRIORITY_TONE: Record<QueuePriority, StatusTone> = { emergency: 'danger', high: 'warning', normal: 'info', low: 'neutral' };

export default function AppointmentRequestsScreen() {
  const { data: requests = [], isLoading, isError, refetch } = useAppointmentRequests();
  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pending requests" />

      {isLoading && requests.length === 0 ? (
        <StateView variant="loading" label="Loading requests" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your requests." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {pending.length === 0 ? (
            <StateView variant="empty" icon={Inbox} title="No pending requests" message="New consultation requests will appear here for you to accept or decline." />
          ) : (
            pending.map((r) => {
              const TypeIcon = TYPE_ICON[r.appointment.consultType];
              return (
                <Pressable
                  key={r.id}
                  style={[styles.card, shadow1]}
                  onPress={() => router.push(`/(doctor)/appointments/requests/${r.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Request from ${r.appointment.patient.name}`}
                >
                  <DoctorAvatar initials={r.appointment.patient.initials} color={r.appointment.patient.avatarColor} size={48} />
                  <View style={styles.body}>
                    <View style={styles.topRow}>
                      <Text style={styles.name} numberOfLines={1}>{r.appointment.patient.name}</Text>
                      <StatusBadge label={QUEUE_PRIORITY_LABELS[r.priority]} tone={PRIORITY_TONE[r.priority]} />
                    </View>
                    <View style={styles.metaRow}>
                      <TypeIcon size={13} color={Colors.secondary} strokeWidth={2} />
                      <Text style={styles.meta} numberOfLines={1}>{r.appointment.slotTime} · {new Date(`${r.appointment.slotDate}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text>
                    </View>
                    {!!r.patientNote && <Text style={styles.note} numberOfLines={1}>{r.patientNote}</Text>}
                  </View>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm, flexGrow: 1 },
  card:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:    { flex: 1, gap: Spacing.xs },
  topRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name:    { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  note:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
