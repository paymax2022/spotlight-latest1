import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Syringe, CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatDate } from '../../constants/health.constants';
import VetStatusPill from './VetStatusPill';
import type { VaccinationEntry } from '../types';

/** Vaccination schedule row with status pill and a schedule CTA when due. */
export default function VaccinationRow({
  entry,
  onSchedule,
}: {
  entry: VaccinationEntry;
  onSchedule?: () => void;
}) {
  const needsAction = entry.status === 'due_soon' || entry.status === 'overdue';
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>
        <Syringe size={18} color={Colors.teal} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>{entry.vaccine}</Text>
        <View style={styles.metaRow}>
          <CalendarClock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.meta}>Due {formatDate(entry.dueAt)}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <VetStatusPill vaccination={entry.status} />
        {needsAction && onSchedule ? (
          <Pressable onPress={onSchedule} hitSlop={6}>
            <Text style={styles.action}>Schedule</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgGreen, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 4 },
  action: { ...Typography.labelMd, color: Colors.secondary },
});
