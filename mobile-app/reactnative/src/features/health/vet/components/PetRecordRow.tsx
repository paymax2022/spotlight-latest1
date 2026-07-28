import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Stethoscope, ScrollText, Syringe, FlaskConical, Scale, FileText, Lock, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatDate } from '../../constants/health.constants';
import type { PetRecordEntry, PetRecordKind } from '../types';

type IconCmp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const KIND_META: Record<PetRecordKind, { icon: IconCmp; color: string; bg: string; label: string }> = {
  consult_note: { icon: Stethoscope, color: Colors.primary, bg: Colors.iconBgPurple, label: 'Consult note' },
  prescription: { icon: ScrollText, color: Colors.secondary, bg: Colors.iconBgBlue, label: 'Prescription' },
  vaccination: { icon: Syringe, color: Colors.teal, bg: Colors.iconBgGreen, label: 'Vaccination' },
  lab_result: { icon: FlaskConical, color: Colors.teal, bg: Colors.iconBgTeal, label: 'Lab result' },
  weight: { icon: Scale, color: Colors.onWarning, bg: Colors.iconBgGold, label: 'Weight' },
  document: { icon: FileText, color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh, label: 'Document' },
};

/**
 * Pet health-record row. Sensitive records (HL-8) show a lock until the consent
 * gate is acknowledged; the parent decides whether the summary is revealed.
 */
export default function PetRecordRow({
  record,
  locked,
  onPress,
}: {
  record: PetRecordEntry;
  locked?: boolean;
  onPress?: () => void;
}) {
  const meta = KIND_META[record.kind];
  const Icon = meta.icon;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}>
      <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
        <Icon size={18} color={meta.color} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.kind}>{meta.label}</Text>
          {record.flagged ? <TriangleAlert size={12} color={Colors.error} strokeWidth={2.4} /> : null}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {record.title}
        </Text>
        {locked && record.sensitive ? (
          <View style={styles.lockedRow}>
            <Lock size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.locked}>Consent required to view</Text>
          </View>
        ) : (
          <Text style={styles.summary} numberOfLines={2}>
            {record.summary}
          </Text>
        )}
        <Text style={styles.meta}>
          {record.providerName ? `${record.providerName} · ` : ''}
          {formatDate(record.at)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  pressed: { opacity: 0.85 },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kind: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locked: { ...Typography.bodySm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 1 },
});
