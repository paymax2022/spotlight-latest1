import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { formatNaira, formatDistance, formatDuration } from '../utils/mobilityFormatters';
import type { Kobo } from '../types/mobility.types';

interface Row {
  label: string;
  valueKobo?: Kobo;
  valueText?: string;
  emphasize?: boolean;
}

interface Props {
  fareKobo: Kobo;
  distanceM?: number;
  durationS?: number;
  surgeMultiplier?: number;
  rows?: Row[];
  /** When true, show that fees/limits are computed and verified by Paymax. */
  showTrustNote?: boolean;
  title?: string;
}

/**
 * Transparent fare summary card (BUILD-CONTRACT: every confirmation must show a
 * fare breakdown). All amounts are display values returned by the backend — the
 * client never computes the fare floor.
 */
export default function FareBreakdownCard({
  fareKobo,
  distanceM,
  durationS,
  surgeMultiplier,
  rows,
  showTrustNote,
  title = 'Fare breakdown',
}: Props) {
  return (
    <View style={[styles.card, shadow1]}>
      <Text style={styles.title}>{title}</Text>

      {(distanceM != null || durationS != null) && (
        <View style={styles.metaRow}>
          {distanceM != null && <Text style={styles.meta}>{formatDistance(distanceM)}</Text>}
          {distanceM != null && durationS != null && <View style={styles.dot} />}
          {durationS != null && <Text style={styles.meta}>{formatDuration(durationS)}</Text>}
          {surgeMultiplier != null && surgeMultiplier > 1 && (
            <>
              <View style={styles.dot} />
              <Text style={[styles.meta, styles.surge]}>{surgeMultiplier.toFixed(1)}× surge</Text>
            </>
          )}
        </View>
      )}

      <View style={styles.divider} />

      {(rows ?? []).map((r) => (
        <View key={r.label} style={styles.row}>
          <Text style={[styles.rowLabel, r.emphasize && styles.rowLabelStrong]}>{r.label}</Text>
          <Text style={[styles.rowValue, r.emphasize && styles.rowValueStrong]}>
            {r.valueText ?? (r.valueKobo != null ? formatNaira(r.valueKobo) : '—')}
          </Text>
        </View>
      ))}

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.totalLabel}>Total fare</Text>
        <Text style={styles.totalValue}>{formatNaira(fareKobo)}</Text>
      </View>

      {showTrustNote && (
        <View style={styles.note}>
          <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>
            Fares and limits are set and verified by Paymax. You will never be charged below the fair price floor.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant },
  title: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  surge: { color: Colors.onWarning, fontWeight: '700' as const },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowLabelStrong: { color: Colors.onSurface, fontWeight: '600' as const },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface },
  rowValueStrong: { fontWeight: '700' as const },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalValue: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  note: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});
