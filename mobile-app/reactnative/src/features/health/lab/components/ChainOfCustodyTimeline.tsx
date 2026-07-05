import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CircleCheck, TriangleAlert, Circle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { formatDate, relativeTime } from '../../constants/health.constants';
import type { ChainOfCustodyEvent } from '../types';

/**
 * HL-6 chain-of-custody trail. Renders the immutable sequence of sample hand-off
 * events; a breach event is flagged red (→ recollect).
 */
export default function ChainOfCustodyTimeline({ events }: { events: ChainOfCustodyEvent[] }) {
  if (events.length === 0) {
    return <Text style={styles.empty}>No custody events recorded yet.</Text>;
  }
  return (
    <View>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const Icon = e.breach ? TriangleAlert : CircleCheck;
        const color = e.breach ? Colors.error : Colors.teal;
        return (
          <View key={e.id} style={styles.row}>
            <View style={styles.railCol}>
              <Icon size={18} color={color} strokeWidth={2.2} />
              {!last ? <View style={styles.rail} /> : null}
            </View>
            <View style={styles.body}>
              <Text style={[styles.label, e.breach && { color: Colors.error }]}>{e.label}</Text>
              <Text style={styles.meta}>
                {e.actor} · {relativeTime(e.at)}
              </Text>
              {e.note ? <Text style={styles.note}>{e.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', gap: Spacing.md },
  railCol: { alignItems: 'center', width: 20 },
  rail: { width: 2, flex: 1, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  body: { flex: 1, paddingBottom: Spacing.md },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
