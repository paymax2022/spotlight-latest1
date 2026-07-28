import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { TriangleAlert, ChevronRight, Paperclip } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { RECORD_KIND_META, HealthColors, formatDate } from '../constants/health.constants';
import type { HealthRecord } from '../types';

/**
 * A single health-record row used in the records vault list. Shows kind icon,
 * title, subject, source/provider, date, attachment count, and a flagged badge
 * for abnormal results (HL-7 escalation context).
 */
export default function RecordCard({
  record,
  showSubject,
  onPress,
}: {
  record: HealthRecord;
  showSubject?: boolean;
  onPress: () => void;
}) {
  const meta = RECORD_KIND_META[record.kind];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.FileText;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}: ${record.title}`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
        <Icon size={20} color={meta.color} strokeWidth={2} />
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.kind}>{meta.label}</Text>
          {record.flagged ? (
            <View style={styles.flag}>
              <TriangleAlert size={12} color={HealthColors.danger} strokeWidth={2.4} />
              <Text style={styles.flagText}>Abnormal</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.title} numberOfLines={1}>
          {record.title}
        </Text>
        <Text style={styles.summary} numberOfLines={1}>
          {record.summary}
        </Text>

        <View style={styles.metaRow}>
          {showSubject ? <Text style={styles.meta}>{record.subjectName} · </Text> : null}
          <Text style={styles.meta}>{record.providerName ?? 'Self-added'}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>{formatDate(record.issuedAt)}</Text>
          {record.docs.length > 0 ? (
            <View style={styles.attach}>
              <Paperclip size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.meta}>{record.docs.length}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  pressed: { opacity: 0.9 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  flagText: { ...Typography.caption, color: HealthColors.danger, fontWeight: '700' as const },
  title: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 3, marginTop: 2 },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  dot: { ...Typography.caption, color: Colors.outline },
  attach: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 4 },
});
