import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Pill } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { RxItem } from '../types';

/** Single e-prescription line item. POM-flagged items get a clear badge (HL-3). */
export default function RxItemRow({ item }: { item: RxItem }) {
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>
        <Pill size={18} color={Colors.secondary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>
            {item.drugName} {item.dosage}
          </Text>
          {item.pom ? (
            <View style={styles.pom}>
              <Text style={styles.pomText}>POM</Text>
            </View>
          ) : (
            <View style={styles.otc}>
              <Text style={styles.otcText}>OTC</Text>
            </View>
          )}
        </View>
        <Text style={styles.detail}>
          {item.form} · {item.frequency} · {item.durationDays} day{item.durationDays === 1 ? '' : 's'} · Qty {item.quantity}
        </Text>
        {item.instructions ? <Text style={styles.instr}>{item.instructions}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface, flex: 1 },
  pom: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  pomText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' as const },
  otc: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  otcText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  detail: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  instr: { ...Typography.bodySm, color: Colors.onSurface, fontStyle: 'italic' },
});
