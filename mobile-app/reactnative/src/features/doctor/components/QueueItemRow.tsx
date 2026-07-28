import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Video, Phone, MessageCircle, Clock } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { DoctorAvatar } from '@/features/telemedicine/components';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import {
  QUEUE_PRIORITY_LABELS,
  APPOINTMENT_BILLING_LABELS,
} from '@/features/doctor/constants';
import type { ConsultationQueueItem, ConsultType } from '@/types/doctor.batch1';

interface Props {
  item:    ConsultationQueueItem;
  onPress: () => void;
}

const TYPE_ICON: Record<ConsultType, LucideIcon> = { video: Video, audio: Phone, chat: MessageCircle };

// New component: a consultation-queue / waiting-room row keyed off
// ConsultationQueueItem. Unlike AppointmentRow (DoctorAppointment, no priority /
// wait-time / billing), this surfaces the priority bucket, minutes waited and
// billing variant a queue needs, so it is genuinely new.
const PRIORITY_TONE: Record<ConsultationQueueItem['priority'], StatusTone> = {
  emergency: 'danger',
  high:      'warning',
  normal:    'info',
  low:       'neutral',
};

const BILLING_TONE: Record<ConsultationQueueItem['billing'], StatusTone> = {
  hmo:            'brand',
  paid:           'success',
  free_follow_up: 'info',
};

export default function QueueItemRow({ item, onPress }: Props) {
  const TypeIcon = TYPE_ICON[item.consultType];
  return (
    <Pressable
      style={[styles.card, shadow1]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Queue item for ${item.patientName}`}
    >
      <DoctorAvatar initials={item.initials} color={item.avatarColor} size={48} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>{item.patientName}</Text>
          <StatusBadge label={QUEUE_PRIORITY_LABELS[item.priority]} tone={PRIORITY_TONE[item.priority]} />
        </View>
        <View style={styles.metaRow}>
          <TypeIcon size={13} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.meta} numberOfLines={1}>{item.ref} · {item.slotTime}</Text>
        </View>
        <View style={styles.bottomRow}>
          <StatusBadge label={APPOINTMENT_BILLING_LABELS[item.billing]} tone={BILLING_TONE[item.billing]} />
          <View style={styles.wait}>
            <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.waitText}>{item.waitMins} min wait</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:      { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:      { flex: 1, gap: Spacing.xs },
  topRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name:      { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  metaRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta:      { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  wait:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  waitText:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
