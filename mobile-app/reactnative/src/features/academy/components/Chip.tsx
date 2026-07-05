import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

interface Props {
  label: string;
  color: string;
  bg: string;
  small?: boolean;
}

/** Status/label pill used for mastery, order status, exam relevance, etc. */
export default function Chip({ label, color, bg, small }: Props) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }, small && styles.small]}>
      <Text style={[styles.text, { color }, small && styles.textSmall]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  small: { paddingHorizontal: 8, paddingVertical: 2 },
  text: { ...Typography.labelSm, fontWeight: '700' },
  textSmall: { ...Typography.caption, fontWeight: '700' },
});
