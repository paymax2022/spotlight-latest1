import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';

interface Props {
  pct: number;           // 0–100
  color?: string;
  trackColor?: string;
  height?: number;
  style?: ViewStyle;
}

/** Lightweight determinate progress bar (no extra deps). */
export default function ProgressBar({ pct, color = Colors.primary, trackColor = Colors.surfaceContainerHigh, height = 8, style }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={[styles.track, { backgroundColor: trackColor, height, borderRadius: height }, style]}>
      <View style={[styles.fill, { backgroundColor: color, width: `${clamped}%`, borderRadius: height }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden', borderRadius: Radius.full },
  fill: { height: '100%' },
});
