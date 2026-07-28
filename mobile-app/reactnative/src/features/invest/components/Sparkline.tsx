import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Defs, LinearGradient as SvgGradient, Stop, Polygon } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { Candle } from '../types/invest.types';

/** Minimal price sparkline from close prices. Green if up over the window. */
export default function Sparkline({ candles, width = 320, height = 120 }: { candles: Candle[]; width?: number; height?: number }) {
  if (!candles || candles.length < 2) return <View style={{ height }} />;
  const closes = candles.map((c) => c.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const stepX = width / (closes.length - 1);
  const points = closes.map((c, i) => `${(i * stepX).toFixed(1)},${(height - ((c - min) / range) * (height - 8) - 4).toFixed(1)}`);
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? Colors.teal : Colors.error;
  const areaPoints = `0,${height} ${points.join(' ')} ${width},${height}`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.18} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </SvgGradient>
      </Defs>
      <Polygon points={areaPoints} fill="url(#spark)" />
      <Polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}
