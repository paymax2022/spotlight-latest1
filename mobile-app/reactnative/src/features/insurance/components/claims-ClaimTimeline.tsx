import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { InsuranceColors } from '../constants/insurance.constants';
import type { ClaimTimelineEntry } from '../claims';

/**
 * Claim status tracker (PRD §15.1 — claim status tracker). Renders the guarded
 * state-machine progression DRAFT→FNOL→assessment→approved→payout→settled with
 * reached steps filled and future steps dimmed.
 */
export default function ClaimTimeline({ entries }: { entries: ClaimTimelineEntry[] }) {
  return (
    <View style={styles.wrap}>
      {entries.map((e, i) => {
        const reached = !!e.at;
        const last = i === entries.length - 1;
        return (
          <View key={e.state} style={styles.row}>
            <View style={styles.railCol}>
              <View style={[styles.node, reached ? styles.nodeOn : styles.nodeOff]} />
              {!last ? <View style={[styles.line, reached ? styles.lineOn : styles.lineOff]} /> : null}
            </View>
            <View style={styles.body}>
              <Text style={[styles.label, !reached && styles.labelOff]}>{e.label}</Text>
              {e.note ? <Text style={[styles.note, !reached && styles.labelOff]}>{e.note}</Text> : null}
              {e.at ? <Text style={styles.at}>{new Date(e.at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  row: { flexDirection: 'row', gap: Spacing.md },
  railCol: { alignItems: 'center', width: 16 },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  nodeOn: { backgroundColor: InsuranceColors.ok, borderColor: InsuranceColors.ok },
  nodeOff: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.outlineVariant },
  line: { width: 2, flex: 1, minHeight: 24, marginVertical: 2 },
  lineOn: { backgroundColor: InsuranceColors.ok },
  lineOff: { backgroundColor: Colors.outlineVariant },
  body: { flex: 1, paddingBottom: Spacing.lg },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  labelOff: { color: Colors.onSurfaceVariant },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  at: { ...Typography.labelSm, color: InsuranceColors.muted, marginTop: 4 },
});
