import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { DoctorAvatar } from '@/features/telemedicine/components';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import { RESULT_STATUS_LABELS } from '@/features/doctor/constants';
import type { LabResultInbox } from '@/types/doctor.batch3';

interface Props {
  item:    LabResultInbox;
  onPress: (item: LabResultInbox) => void;
}

// New component: a results-inbox list row (patient + lab + status + new/critical
// flags). It composes DoctorAvatar + StatusBadge with the new/critical markers
// the inbox needs; no existing row renders these flags together.
const STATUS_TONE: Record<string, StatusTone> = {
  muted:   'neutral',
  success: 'success',
  warning: 'warning',
};

export default function ResultInboxRow({ item, onPress }: Props) {
  const cfg = RESULT_STATUS_LABELS[item.status];
  const date = item.reportedAt
    ? new Date(item.reportedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
    : 'Awaiting';
  return (
    <Pressable
      style={[styles.row, item.hasCritical && styles.rowCritical]}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Result ${item.ref} for ${item.patient.name}`}
    >
      <DoctorAvatar initials={item.patient.initials} color={item.patient.avatarColor} size={44} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{item.patient.name}</Text>
          {item.isNew && <View style={styles.newDot} />}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{item.ref} · {item.labName}</Text>
        <Text style={styles.meta} numberOfLines={1}>{date}</Text>
        {item.hasCritical && (
          <View style={styles.criticalRow}>
            <AlertTriangle size={12} color={Colors.error} strokeWidth={2.4} />
            <Text style={styles.criticalText}>Critical value</Text>
          </View>
        )}
      </View>
      <View style={styles.right}>
        <StatusBadge label={cfg.label} tone={STATUS_TONE[cfg.tone] ?? 'neutral'} />
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  rowCritical:  { borderColor: Colors.error },
  body:         { flex: 1, gap: 2 },
  titleRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name:         { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  newDot:       { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  meta:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  criticalRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  criticalText: { ...Typography.labelSm, color: Colors.error, fontWeight: '700' },
  right:        { alignItems: 'flex-end', gap: Spacing.xs },
});
