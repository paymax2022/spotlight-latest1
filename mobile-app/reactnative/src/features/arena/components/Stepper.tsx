import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { STEPPER, stepperIndexForState } from '../constants';
import type { ContestantState } from '../types';

/**
 * Contestant progress stepper: Applied → Screened → Trained → Theory →
 * Qualified → Finalist → Crowned. Reads the current lifecycle state and marks
 * nodes done / current / upcoming. Horizontal-scroll-free (fits 7 compact nodes).
 */
export default function Stepper({ state }: { state: ContestantState }) {
  const currentIndex = stepperIndexForState(state);

  return (
    <View style={styles.row}>
      {STEPPER.map((node, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        return (
          <React.Fragment key={node.key}>
            <View style={styles.node}>
              <View style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]}>
                {done ? (
                  <Check size={12} color={Colors.onPrimary} strokeWidth={3} />
                ) : (
                  <Text style={[styles.dotNum, current && styles.dotNumCurrent]}>{i + 1}</Text>
                )}
              </View>
              <Text
                style={[styles.label, (done || current) && styles.labelActive]}
                numberOfLines={1}
              >
                {node.label}
              </Text>
            </View>
            {i < STEPPER.length - 1 ? (
              <View style={[styles.connector, i < currentIndex && styles.connectorDone]} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.sm },
  node: { alignItems: 'center', width: 40 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
  },
  dotDone: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  dotCurrent: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dotNum: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  dotNumCurrent: { color: Colors.onPrimary },
  label: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 2 },
  labelActive: { color: Colors.onSurface, fontWeight: '600' as const },
  connector: {
    height: 2,
    flex: 1,
    backgroundColor: Colors.outlineVariant,
    marginTop: 11,
    marginHorizontal: -6,
  },
  connectorDone: { backgroundColor: Colors.teal },
});
