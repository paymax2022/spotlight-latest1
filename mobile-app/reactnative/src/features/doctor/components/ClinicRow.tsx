import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Building2, Check, CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';

interface Props {
  name:        string;
  roleLabel:   string;
  location?:   string;
  scheduleText: string;          // e.g. "Mon, Tue, Wed - 09:00-17:00"
  feeSharePct: number;
  patientsSeen: number;
  active:      boolean;
  busy?:       boolean;
  onSetActive: () => void;
  onEditSchedule: () => void;
}

// New component: a multi-clinic membership row (clinic + role badge + schedule
// + set-active / edit-schedule actions). EditableListCard is a generic edit/
// remove read-row without an "active" affordance or schedule line, so a
// clinic-specific row is justified for screen 10.
export default function ClinicRow({ name, roleLabel, location, scheduleText, feeSharePct, patientsSeen, active, busy, onSetActive, onEditSchedule }: Props) {
  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <View style={styles.head}>
        <View style={styles.iconBox}>
          <Building2 size={20} color={Colors.primary} strokeWidth={2} />
        </View>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {!!location && <Text style={styles.meta} numberOfLines={1}>{location}</Text>}
        </View>
        <StatusBadge label={roleLabel} tone="brand" />
      </View>

      <View style={styles.scheduleRow}>
        <CalendarClock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.schedule} numberOfLines={2}>{scheduleText}</Text>
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>{patientsSeen.toLocaleString('en-NG')} patients</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.stat}>{feeSharePct}% fee share</Text>
      </View>

      <View style={styles.actions}>
        {active ? (
          <View style={styles.activePill}>
            <Check size={14} color={Colors.teal} strokeWidth={2.6} />
            <Text style={styles.activeText}>Active clinic</Text>
          </View>
        ) : (
          <Pressable onPress={onSetActive} disabled={busy} style={[styles.setBtn, busy && styles.disabled]} accessibilityRole="button" accessibilityLabel={`Set ${name} as active`}>
            <Text style={styles.setText}>Set active</Text>
          </Pressable>
        )}
        <Pressable onPress={onEditSchedule} style={styles.editBtn} accessibilityRole="button" accessibilityLabel={`Edit schedule for ${name}`}>
          <Text style={styles.editText}>Edit schedule</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm, marginBottom: Spacing.sm },
  cardActive:  { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  head:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox:     { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  body:        { flex: 1, gap: 2 },
  name:        { ...Typography.labelLg, color: Colors.onSurface },
  meta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  scheduleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  schedule:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  statsRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  stat:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot:         { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  actions:     { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  setBtn:      { flex: 1, height: 44, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
  setText:     { ...Typography.labelMd, color: Colors.onPrimary },
  disabled:    { opacity: 0.5 },
  activePill:  { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderRadius: Radius.lg, backgroundColor: Colors.iconBgTeal },
  activeText:  { ...Typography.labelMd, color: Colors.teal },
  editBtn:     { flex: 1, height: 44, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  editText:    { ...Typography.labelMd, color: Colors.onSurface },
});
