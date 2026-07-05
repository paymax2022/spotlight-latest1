import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { RISK_BAND_LABEL, RISK_BAND_COLOR } from '../constants';
import type { RiskBand } from '../types';

export default function RiskBandPill({ band, small }: { band: RiskBand; small?: boolean }) {
  const color = RISK_BAND_COLOR[band];
  return (
    <View style={[styles.pill, { backgroundColor: color + '1A' }, small && styles.small]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{RISK_BAND_LABEL[band]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...Typography.labelSm, fontWeight: '600' },
});
