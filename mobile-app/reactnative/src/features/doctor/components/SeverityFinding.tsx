import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';

interface Props {
  title:          string;
  kindLabel:      string;          // e.g. "Drug interaction"
  severityLabel:  string;          // e.g. "High"
  tone:           StatusTone;      // severity -> StatusBadge tone
  detail:         string;
  drugs:          string[];
  recommendation: string;
}

// New component: an AI safety finding card. StatusBadge + InfoRow do not compose
// cleanly into a finding (kind chip + severity badge + detail + implicated drugs
// + recommendation block), so a dedicated row keeps the rx-safety list readable.
export default function SeverityFinding({ title, kindLabel, severityLabel, tone, detail, drugs, recommendation }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.kind}>{kindLabel}</Text>
        <StatusBadge label={severityLabel} tone={tone} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {drugs.length > 0 && (
        <View style={styles.drugs}>
          {drugs.map((d) => (
            <View key={d} style={styles.drugChip}>
              <Text style={styles.drugText}>{d}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.recBox}>
        <Text style={styles.recLabel}>Recommendation</Text>
        <Text style={styles.recText}>{recommendation}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:     { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.xs, marginBottom: Spacing.sm },
  head:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  kind:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  title:    { ...Typography.labelLg, color: Colors.onSurface },
  detail:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  drugs:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  drugChip: { height: 26, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  drugText: { ...Typography.labelSm, color: Colors.onSurface },
  recBox:   { marginTop: Spacing.xs, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, gap: 2 },
  recLabel: { ...Typography.labelSm, color: Colors.primary },
  recText:  { ...Typography.bodySm, color: Colors.onSurface },
});
