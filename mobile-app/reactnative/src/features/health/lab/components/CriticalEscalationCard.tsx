import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TriangleAlert, CircleCheck, Circle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CRITICAL_RESULT_COPY } from '../constants';
import { relativeTime } from '../../constants/health.constants';
import type { CriticalEscalation } from '../types';

/**
 * HL-7 critical-result escalation block. Escalation is NEVER silent — this card
 * surfaces the current escalation status and the human notification trail.
 */
export default function CriticalEscalationCard({ escalation }: { escalation: CriticalEscalation }) {
  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.head}>
        <TriangleAlert size={20} color={Colors.error} strokeWidth={2.2} />
        <Text style={styles.title}>Critical value — escalation active</Text>
      </View>
      <Text style={styles.lede}>{CRITICAL_RESULT_COPY}</Text>
      <Text style={styles.analyte}>Triggered by: {escalation.analyteName}</Text>
      {escalation.notifiedClinician ? (
        <Text style={styles.clinician}>Clinician notified: {escalation.notifiedClinician}</Text>
      ) : null}

      <View style={styles.steps}>
        {escalation.steps.map((s, i) => (
          <View key={i} style={styles.step}>
            {s.done ? (
              <CircleCheck size={16} color={Colors.teal} strokeWidth={2.2} />
            ) : (
              <Circle size={16} color={Colors.outline} strokeWidth={2} />
            )}
            <Text style={[styles.stepLabel, !s.done && styles.stepPending]}>
              {s.label}
              {s.at ? ` · ${relativeTime(s.at)}` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.error, flex: 1 },
  lede: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 19 },
  analyte: { ...Typography.labelMd, color: Colors.error },
  clinician: { ...Typography.bodySm, color: Colors.onSurface },
  steps: { gap: Spacing.sm, marginTop: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  stepPending: { color: Colors.onSurfaceVariant },
});
