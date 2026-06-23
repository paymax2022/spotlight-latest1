import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Pill } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { Prescription } from '@/types/telemedicine';

export default function PrescriptionCard({ prescription }: { prescription: Prescription }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Pill size={18} color={Colors.primary} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Prescription</Text>
          <Text style={styles.sub}>By {prescription.doctorName}</Text>
        </View>
      </View>

      {prescription.items.map((item, i) => (
        <View key={i} style={[styles.item, i > 0 && styles.itemBorder]}>
          <Text style={styles.medName}>{item.name}</Text>
          <View style={styles.detailRow}>
            <Detail label="Dosage" value={item.dosage} />
            <Detail label="Frequency" value={item.frequency} />
            <Detail label="Duration" value={item.duration} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  header:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  iconBox:     { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title:       { ...Typography.titleMd, color: Colors.onSurface },
  sub:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  item:        { paddingVertical: Spacing.sm, gap: 6 },
  itemBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  medName:     { ...Typography.labelLg, color: Colors.onSurface },
  detailRow:   { flexDirection: 'row', gap: Spacing.md },
  detail:      { flex: 1, gap: 2 },
  detailLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  detailValue: { ...Typography.labelSm, color: Colors.onSurface },
});
