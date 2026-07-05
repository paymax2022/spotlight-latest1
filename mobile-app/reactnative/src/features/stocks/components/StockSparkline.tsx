import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { Candle } from '../types/stocks.types';

interface Props {
  data: Candle[];
  width: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

/**
 * Price line/area chart for asset detail + home cards. Pure react-native-svg,
 * mirroring CryptoSparkline so charting stays consistent across modules. Stroke
 * colour defaults to teal (rising) / error (falling) when not supplied.
 */
export default function StockSparkline({ data, width, height = 140, color, fill = true }: Props) {
  if (!data || data.length < 2) return <View style={{ width, height }} />;

  const values = data.map((d) => d.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 6;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * innerW;
    const y = pad + (1 - (d.price - min) / range) * innerH;
    return { x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;
  const rising = values[values.length - 1] >= values[0];
  const stroke = color ?? (rising ? Colors.teal : Colors.error);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="stockSpark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.18} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {fill ? <Path d={area} fill="url(#stockSpark)" /> : null}
      <Path d={line} stroke={stroke} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
