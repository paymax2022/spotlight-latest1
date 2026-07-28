import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { RatePoint } from '../types/fx.types';

interface Props {
  data: RatePoint[];
  width: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

/**
 * Lightweight line/area sparkline for rate history & rate-movement cards
 * (spec C → Rate history chart / Rate movement card). Pure react-native-svg,
 * matching the project's existing svg usage (visitor QrCodeView).
 */
export default function RateSparkline({ data, width, height = 120, color = Colors.secondary, fill = true }: Props) {
  if (!data || data.length < 2) return <View style={{ width, height }} />;

  const values = data.map((d) => d.rate);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 6;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * innerW;
    const y = pad + (1 - (d.rate - min) / range) * innerH;
    return { x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;
  const rising = values[values.length - 1] >= values[0];
  const stroke = color ?? (rising ? Colors.teal : Colors.error);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.18} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {fill ? <Path d={area} fill="url(#spark)" /> : null}
      <Path d={line} stroke={stroke} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
