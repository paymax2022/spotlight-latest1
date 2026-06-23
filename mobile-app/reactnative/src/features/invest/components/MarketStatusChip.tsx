import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

/** Clearly labels market/data status (iron rule: every status is labelled). */
export default function MarketStatusChip({ status, dataStatus }: { status?: string; dataStatus?: string }) {
  const open = status === 'open';
  return (
    <View style={[styles.chip, { backgroundColor: open ? Colors.iconBgTeal : Colors.surfaceContainerHigh }]}>
      <View style={[styles.dot, { backgroundColor: open ? Colors.teal : Colors.outline }]} />
      <Text style={styles.text}>
        {open ? 'Market open' : 'Market closed'}{dataStatus ? ` · ${dataStatus}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { ...Typography.labelSm, color: Colors.onSurface },
});
