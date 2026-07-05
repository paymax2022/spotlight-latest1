import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { formatDate, relativeTime } from '../constants/health.constants';
import type { OrderEvent } from '../pharmacy/types';

/**
 * Vertical order-status timeline (HL-9 lifecycle: placed → confirmed → dispensed
 * → delivery/pickup → completed). Done steps show a teal check; the active step
 * is highlighted.
 */
export default function PharmacyOrderTimeline({ events }: { events: OrderEvent[] }) {
  const activeIndex = events.findIndex((e) => !e.done);

  return (
    <View style={styles.wrap}>
      {events.map((e, i) => {
        const isActive = i === activeIndex;
        const isLast = i === events.length - 1;
        return (
          <View key={`${e.status}-${i}`} style={styles.row}>
            <View style={styles.railCol}>
              <View style={[styles.node, e.done && styles.nodeDone, isActive && styles.nodeActive]}>
                {e.done ? <Check size={12} color={Colors.white} strokeWidth={3} /> : null}
              </View>
              {!isLast ? <View style={[styles.line, e.done && styles.lineDone]} /> : null}
            </View>
            <View style={styles.body}>
              <Text style={[styles.label, (e.done || isActive) && styles.labelActive]}>{e.label}</Text>
              {e.at ? (
                <Text style={styles.time}>
                  {relativeTime(e.at)} · {formatDate(e.at)}
                </Text>
              ) : isActive ? (
                <Text style={styles.time}>In progress…</Text>
              ) : null}
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
  railCol: { alignItems: 'center', width: 22 },
  node: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDone: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  nodeActive: { borderColor: Colors.primary },
  line: { width: 2, flex: 1, minHeight: 24, backgroundColor: Colors.outlineVariant },
  lineDone: { backgroundColor: Colors.teal },
  body: { flex: 1, paddingBottom: Spacing.lg },
  label: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  labelActive: { color: Colors.onSurface },
  time: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
