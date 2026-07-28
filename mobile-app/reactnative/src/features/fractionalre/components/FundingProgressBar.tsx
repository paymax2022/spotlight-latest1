import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { formatNairaCompact, progressPct } from '../utils';

interface Props {
  raisedKobo: number;
  targetKobo: number;
  showLabels?: boolean;
}

export default function FundingProgressBar({ raisedKobo, targetKobo, showLabels = true }: Props) {
  const pct = progressPct(raisedKobo, targetKobo);
  return (
    <View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      {showLabels ? (
        <View style={styles.row}>
          <Text style={styles.raised}>{formatNairaCompact(raisedKobo)} raised</Text>
          <Text style={styles.pct}>{pct}% of {formatNairaCompact(targetKobo)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.tertiaryContainer === '#00453F' ? '#16A34A' : Colors.teal },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  raised: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' },
  pct: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
