import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  scrollable?: boolean;       // for long filter rows (status/type filters etc.)
}

/**
 * Shared sliding segmented control (DESIGN-Mobile.md → Navigation → Segmented
 * Control: sliding background indicator with 8px radius). Also serves as the
 * standard filter-chip row used across discovery / history / wizard screens.
 *
 * Promoted to src/components so feature modules don't depend on each other for a
 * core UI primitive (the crowdfunding module has an equivalent that predates this
 * and can migrate to this shared one).
 */
export default function SegmentedControl<T extends string>({ options, value, onChange, scrollable }: Props<T>) {
  const content = options.map((opt) => {
    const active = opt.value === value;
    return (
      <Pressable
        key={opt.value}
        onPress={() => onChange(opt.value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        style={[styles.seg, scrollable && styles.segScroll, active && styles.segActive]}
      >
        <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
        {content}
      </ScrollView>
    );
  }

  return <View style={styles.track}>{content}</View>;
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.md,
    padding: 4,
    marginHorizontal: Spacing.containerMargin,
  },
  scrollRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  seg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: Radius.DEFAULT,
  },
  segScroll: {
    flex: 0,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.full,
  },
  segActive: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderColor: Colors.primary,
    ...({ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 }),
  },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  labelActive: { color: Colors.primary, fontWeight: '700' as const },
});
