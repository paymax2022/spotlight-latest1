import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Activity } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import type { AuditTrailEntry } from '@/types/doctor.batch7';

interface Props {
  entry:   AuditTrailEntry;
  border?: boolean;
}

// New component: a scoped audit-trail row (detail + ref + patient + actor + at)
// for the AB audit-trail screens. The compliance dashboard inlines a plain
// audit row, but it does not surface the ref/patient that the scoped trail
// needs, so a dedicated row keeps the four audit screens consistent.
export default function AuditEntryRow({ entry, border }: Props) {
  const at = new Date(entry.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.row, border && styles.border]}>
      <Activity size={16} color={Colors.teal} strokeWidth={2} />
      <View style={styles.body}>
        <Text style={styles.detail}>{entry.detail}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {entry.actor}
          {entry.ref ? ` · ${entry.ref}` : ''}
          {entry.patientName ? ` · ${entry.patientName}` : ''} · {at}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:    { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  border: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  body:   { flex: 1, gap: 2 },
  detail: { ...Typography.bodySm, color: Colors.onSurface },
  meta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
});
