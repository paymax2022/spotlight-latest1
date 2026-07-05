import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';

interface Props {
  /** 0–100 completion. */
  pct: number;
  /** Fill colour (defaults to the brand teal "growth" tint). */
  color?: string;
  style?: ViewStyle;
}

/** Thin rounded progress track used on path cards and the path-detail header. */
export default function ProgressBar({ pct, color = Colors.teal, style }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={[styles.track, style]} accessibilityRole="progressbar" accessibilityValue={{ now: clamped, min: 0, max: 100 }}>
      <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: Radius.full },
});
