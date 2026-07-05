import React from 'react';
import { View, Text, StyleSheet, TextStyle } from 'react-native';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { formatPct } from '../utils/stockFormatters';

interface Props {
  pct: number;
  showIcon?: boolean;
  textStyle?: TextStyle;
}

/** Signed change — teal when up, error-red when down (semantic tokens). */
export default function PriceChange({ pct, showIcon = false, textStyle }: Props) {
  const up = pct >= 0;
  const color = up ? Colors.teal : Colors.error;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <View style={styles.row}>
      {showIcon ? <Icon size={14} color={color} strokeWidth={2.2} /> : null}
      <Text style={[styles.text, { color }, textStyle]}>{formatPct(pct)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  text: { ...Typography.labelMd },
});
