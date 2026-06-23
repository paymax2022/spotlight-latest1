import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  count:  number;
  active: number;   // 0-based index of the active dot
}

// New component (Section A · entry 2): the paged-carousel position indicator.
// No existing component renders a dots row (WizardProgress is a fill bar, not
// discrete page dots), so this is genuinely new.
export default function CarouselDots({ count, active }: Props) {
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityValue={{ min: 1, max: count, now: active + 1 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === active && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  dot:       { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  dotActive: { width: 22, backgroundColor: Colors.primary },
});
