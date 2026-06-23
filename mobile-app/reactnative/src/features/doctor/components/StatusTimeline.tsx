import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

export interface TimelineStep {
  label:     string;
  at?:       string;   // pre-formatted datetime / caption
  note?:     string;
  completed: boolean;
  current?:  boolean;
}

interface Props {
  steps: TimelineStep[];
}

// New component: a vertical step/progress timeline used by drug delivery (#2)
// and HMO claim (#6) event histories. No existing component renders a connected
// node-and-rail timeline, so this is genuinely new.
export default function StatusTimeline({ steps }: Props) {
  return (
    <View style={styles.wrap}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const active = step.completed || step.current;
        return (
          <View key={`${step.label}-${i}`} style={styles.row}>
            <View style={styles.railCol}>
              <View
                style={[
                  styles.node,
                  step.completed && styles.nodeDone,
                  step.current && styles.nodeCurrent,
                ]}
              >
                {step.completed && <Check size={12} color={Colors.onPrimary} strokeWidth={3} />}
              </View>
              {!isLast && <View style={[styles.rail, active && styles.railActive]} />}
            </View>
            <View style={styles.body}>
              <Text style={[styles.label, !active && styles.labelMuted]} numberOfLines={2}>{step.label}</Text>
              {!!step.at && <Text style={styles.meta}>{step.at}</Text>}
              {!!step.note && <Text style={styles.note}>{step.note}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:        {},
  row:         { flexDirection: 'row', gap: Spacing.md },
  railCol:     { alignItems: 'center', width: 24 },
  node:        { width: 24, height: 24, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerHigh, borderWidth: 2, borderColor: Colors.surfaceContainerHigh },
  nodeDone:    { backgroundColor: Colors.teal, borderColor: Colors.teal },
  nodeCurrent: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.secondary },
  rail:        { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  railActive:  { backgroundColor: Colors.teal },
  body:        { flex: 1, paddingBottom: Spacing.md, gap: 2 },
  label:       { ...Typography.labelMd, color: Colors.onSurface },
  labelMuted:  { color: Colors.onSurfaceVariant },
  meta:        { ...Typography.caption, color: Colors.onSurfaceVariant },
  note:        { ...Typography.caption, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
});
