import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Video, Phone, MessageCircle, ChevronRight, ShieldCheck, CalendarDays } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { DoctorAvatar, ConsultStatusBadge } from '@/features/telemedicine/components';
import { formatSlotDateLabel } from '@/features/doctor/dashboardWire';
import type { DoctorAppointment } from '@/types/doctor';

interface Props {
  appointment: DoctorAppointment;
  onPress:     () => void;
}

// Keyed by string, not ConsultType: appointments.consultation_type allows in_person, which the
// union does not have yet (follow-up F4). `TYPE_ICON[x]` is undefined for an unmapped type and
// rendering undefined throws. This row is reachable that way only from a stored value: the queue
// passes consultation_type through verbatim, while the booking path has refused in_person since
// 3e061a53e — normalizeConsultMode (backend/internal/telemedicine/consult.go:52-62) has no case.
const TYPE_ICON: Record<string, LucideIcon> = { video: Video, audio: Phone, chat: MessageCircle };
const FALLBACK_ICON = CalendarDays;

// New component: doctor-side appointment row keyed off DoctorAppointment (shows
// the PATIENT, not the doctor). The patient-side AppointmentRow lives inside a
// protected telemedicine screen and uses a different type, so this is new.
export default function AppointmentRow({ appointment, onPress }: Props) {
  const TypeIcon = TYPE_ICON[appointment.consultType] ?? FALLBACK_ICON;
  const dateLabel = formatSlotDateLabel(appointment.slotDate);

  return (
    <Pressable
      style={[styles.card, shadow1]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Appointment with ${appointment.patient.name}`}
    >
      <DoctorAvatar initials={appointment.patient.initials} color={appointment.patient.avatarColor} size={48} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{appointment.patient.name}</Text>
        <View style={styles.metaRow}>
          <TypeIcon size={13} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.meta} numberOfLines={1}>{dateLabel} · {appointment.slotTime}</Text>
        </View>
        {appointment.isHmo && (
          <View style={styles.hmoTag}>
            <ShieldCheck size={12} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.hmoText} numberOfLines={1}>{appointment.hmoProvider ?? 'HMO covered'}</Text>
          </View>
        )}
      </View>
      <View style={styles.right}>
        <ConsultStatusBadge status={appointment.status} />
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:    { flex: 1, gap: 2 },
  name:    { ...Typography.titleMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  hmoTag:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  hmoText: { ...Typography.caption, color: Colors.teal },
  right:   { alignItems: 'flex-end', gap: Spacing.sm },
});
