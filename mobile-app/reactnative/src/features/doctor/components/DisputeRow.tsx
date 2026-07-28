import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import { DISPUTE_KIND_LABELS, DISPUTE_STATUS_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.batch7.api';
import type { Dispute, DisputeKind } from '@/types/doctor.batch7';

// New component: a tappable dispute summary row for the AA dispute list. The
// eight dispute kinds collapse to one row keyed off Dispute.kind; existing rows
// (TicketRow inline, AlertCard) do not model ref + kind + disputed-amount +
// status, so this is genuinely new. Reuses StatusBadge for the status pill.

// Map a kind's Lucide icon by name (constants expose Ionicons-style names which
// do not apply to the Lucide-based row, so we keep a small local Lucide map).
const KIND_ICONS: Record<DisputeKind, Icons.LucideIcon> = {
  consultation:      Icons.Stethoscope,
  payment:           Icons.Wallet,
  pharmacy:          Icons.Pill,
  lab:               Icons.FlaskConical,
  hmo:               Icons.ShieldCheck,
  prescription:      Icons.FileText,
  call_failure:      Icons.PhoneOff,
  patient_complaint: Icons.UserRound,
};

// Dispute status -> StatusBadge tone.
const STATUS_TONE: Record<Dispute['status'], StatusTone> = {
  open:              'info',
  under_review:      'warning',
  awaiting_response: 'warning',
  resolved:          'success',
  rejected:          'danger',
};

interface Props {
  dispute: Dispute;
  onPress: () => void;
}

export default function DisputeRow({ dispute, onPress }: Props) {
  const Icon = KIND_ICONS[dispute.kind];
  const date = new Date(dispute.updatedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={dispute.subject}>
      <View style={styles.iconBox}>
        <Icon size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.subject} numberOfLines={1}>{dispute.subject}</Text>
          <StatusBadge label={DISPUTE_STATUS_LABELS[dispute.status]} tone={STATUS_TONE[dispute.status]} />
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {dispute.ref} · {DISPUTE_KIND_LABELS[dispute.kind]} · {date}
          {typeof dispute.amountKobo === 'number' ? ` · ${formatKobo(dispute.amountKobo)}` : ''}
        </Text>
      </View>
      <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  pressed: { opacity: 0.7 },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  body:    { flex: 1, gap: 4 },
  top:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  subject: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
});
