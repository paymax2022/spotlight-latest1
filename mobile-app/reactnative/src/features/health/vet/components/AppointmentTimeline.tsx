import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { APPT_TIMELINE, apptTimelineIndex } from '../constants';
import type { AppointmentStatus } from '../types';

/** Vertical step timeline for the appointment lifecycle. */
export default function AppointmentTimeline({ status }: { status: AppointmentStatus }) {
  if (status === 'CANCELLED' || status === 'NO_SHOW') {
    return (
      <View style={styles.terminal}>
        <Text style={styles.terminalText}>
          {status === 'CANCELLED'
            ? 'This appointment was cancelled. Any held payment is refunded.'
            : 'Marked as no-show.'}
        </Text>
      </View>
    );
  }
  const current = apptTimelineIndex(status);
  return (
    <View style={styles.wrap}>
      {APPT_TIMELINE.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={step.status} style={styles.row}>
            <View style={styles.railCol}>
              <View style={[styles.dot, (done || active) && styles.dotOn, active && styles.dotActive]}>
                {done ? <Check size={11} color={Colors.white} strokeWidth={3} /> : null}
              </View>
              {i < APPT_TIMELINE.length - 1 ? <View style={[styles.line, done && styles.lineOn]} /> : null}
            </View>
            <Text style={[styles.label, (done || active) && styles.labelOn]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  railCol: { alignItems: 'center', width: 22 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  dotOn: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  dotActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  line: { width: 2, flex: 1, minHeight: 22, backgroundColor: Colors.outlineVariant },
  lineOn: { backgroundColor: Colors.teal },
  label: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingBottom: Spacing.md, paddingTop: 1 },
  labelOn: { color: Colors.onSurface, fontWeight: '600' as const },
  terminal: { backgroundColor: Colors.errorContainer, borderRadius: 12, padding: Spacing.md },
  terminalText: { ...Typography.bodySm, color: Colors.error },
});
