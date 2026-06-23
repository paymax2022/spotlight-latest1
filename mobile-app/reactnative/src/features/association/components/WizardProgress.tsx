import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { WIZARD_STEPS } from '../constants/orgWizard.constants';

interface Props {
  /** Zero-based index of the current step. */
  step: number;
}

/** Slim step indicator for the org-creation wizard (dots + current label). */
export default function WizardProgress({ step }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {WIZARD_STEPS.map((_, i) => (
          <View key={i} style={[styles.dot, i <= step ? styles.dotOn : styles.dotOff, i === step && styles.dotCurrent]} />
        ))}
      </View>
      <Text style={styles.label}>Step {step + 1} of {WIZARD_STEPS.length} · {WIZARD_STEPS[step]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm, gap: 6 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { height: 4, borderRadius: Radius.full, flex: 1 },
  dotOff: { backgroundColor: Colors.surfaceContainerHigh },
  dotOn: { backgroundColor: Colors.primary },
  dotCurrent: { backgroundColor: Colors.primary },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
