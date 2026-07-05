import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { KIND_COLOR } from '../constants';
import { formatNairaCompact } from '../utils';
import type { AllocationSlice } from '../types';

interface Props {
  slices: AllocationSlice[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}

/** Portfolio allocation donut (react-native-svg) + legend with kobo values. */
export default function AllocationDonut({ slices, size = 160, centerLabel, centerValue }: Props) {
  const data = slices.filter((s) => s.pct > 0);
  const stroke = 18;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${cx}, ${cy}`}>
            <Circle cx={cx} cy={cy} r={r} stroke={Colors.surfaceContainerHigh} strokeWidth={stroke} fill="none" />
            {data.map((s) => {
              const len = (s.pct / 100) * circ;
              const seg = (
                <Circle
                  key={s.kind}
                  cx={cx} cy={cy} r={r}
                  stroke={KIND_COLOR[s.kind]} strokeWidth={stroke} fill="none"
                  strokeDasharray={`${len} ${circ - len}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              );
              offset += len;
              return seg;
            })}
          </G>
        </Svg>
        {(centerLabel || centerValue) ? (
          <View style={styles.center} pointerEvents="none">
            {centerValue ? <Text style={styles.centerValue}>{centerValue}</Text> : null}
            {centerLabel ? <Text style={styles.centerLabel}>{centerLabel}</Text> : null}
          </View>
        ) : null}
      </View>

      <View style={styles.legend}>
        {data.map((s) => (
          <View key={s.kind} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: KIND_COLOR[s.kind] }]} />
            <Text style={styles.legendLabel}>{s.label}</Text>
            <Text style={styles.legendVal}>{s.pct}% · {formatNairaCompact(s.valueKobo)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md, alignItems: 'center' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  centerValue: { ...Typography.titleMd, color: Colors.onSurface },
  centerLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  legend: { gap: 8, alignSelf: 'stretch' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  legendVal: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
