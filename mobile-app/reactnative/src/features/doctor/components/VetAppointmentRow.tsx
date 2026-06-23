import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Video, Phone, MessageCircle, User, ChevronRight, AlertTriangle, ShieldCheck, PawPrint } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import { VET_APPOINTMENT_STATUS_LABELS, PET_SPECIES_LABELS } from '@/features/doctor/constants';
import type { VetAppointment, VetConsultType, VetAppointmentStatus } from '@/types/doctor.batch5';

interface Props {
  appointment: VetAppointment;
  feeText:     string;            // pre-formatted kobo via formatKobo (caller hook)
  onPress:     () => void;
}

// New component: vet-side appointment row keyed off VetAppointment (shows the PET
// + owner + consult type + status). The human AppointmentRow is typed to
// DoctorAppointment/ConsultType and renders patient identity, so it does not fit
// the vet shape — this is the justified vet analogue.
const TYPE_ICON: Record<VetConsultType, LucideIcon> = { video: Video, audio: Phone, chat: MessageCircle, in_person: User };

const STATUS_TONE: Record<VetAppointmentStatus, StatusTone> = {
  requested: 'info', scheduled: 'brand', in_progress: 'warning', completed: 'success', cancelled: 'danger', no_show: 'neutral',
};

export default function VetAppointmentRow({ appointment, feeText, onPress }: Props) {
  const TypeIcon = TYPE_ICON[appointment.consultType];
  const s = appointment.summary;

  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${s.petName} appointment`}>
      <View style={styles.icon}>
        <PawPrint size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{s.petName}</Text>
          {appointment.isHmo && <ShieldCheck size={13} color={Colors.teal} strokeWidth={2.2} />}
          {s.isUrgent && (
            <View style={styles.urgent}>
              <AlertTriangle size={10} color={Colors.error} strokeWidth={2.4} />
              <Text style={styles.urgentText}>Urgent</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{PET_SPECIES_LABELS[s.petSpecies]} - {s.breed} - {s.ownerName}</Text>
        <View style={styles.typeRow}>
          <TypeIcon size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.reason} numberOfLines={1}>{s.reason}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <StatusBadge label={VET_APPOINTMENT_STATUS_LABELS[appointment.status]} tone={STATUS_TONE[appointment.status]} />
        <Text style={styles.fee}>{feeText}</Text>
        <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  icon:       { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  body:       { flex: 1, gap: 2 },
  top:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name:       { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  urgent:     { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, paddingHorizontal: 6, borderRadius: Radius.full, backgroundColor: Colors.errorContainer },
  urgentText: { ...Typography.caption, color: Colors.error, fontWeight: '700' },
  meta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  typeRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reason:     { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  right:      { alignItems: 'flex-end', gap: 4 },
  fee:        { ...Typography.labelSm, color: Colors.teal },
});
