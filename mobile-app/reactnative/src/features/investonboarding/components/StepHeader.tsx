import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  step: number;   // 1-based current step
  total: number;  // total steps
  label?: string; // optional caption beside the "Step x of n" text
}

/**
 * Progress dots + "Step x of n" caption for the multi-step onboarding flows.
 * Design tokens only; sits under the ScreenHeader on each wizard screen.
 */
export default function StepHeader({ step, total, label }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < step ? styles.dotDone : styles.dotPending]}
          />
        ))}
      </View>
      <Text style={styles.caption}>
        Step {step} of {total}{label ? ` · ${label}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, gap: Spacing.sm },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { flex: 1, height: 6, borderRadius: Radius.full },
  dotDone: { backgroundColor: Colors.primary },
  dotPending: { backgroundColor: Colors.surfaceContainerHigh },
  caption: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
