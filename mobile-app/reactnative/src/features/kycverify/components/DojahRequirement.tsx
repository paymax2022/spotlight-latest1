import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Info, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { ID_FORMATS, dojahLookup, formatIdNumberForDisplay } from '../idFormats';
import type { IdType } from '../types';

interface Props {
  idType: IdType;
  /** Current input; shown masked so a screenshot never leaks the full number. */
  idNumber: string;
}

/**
 * The two facts a user needs before typing an ID number: exactly what Dojah
 * accepts, and exactly what leaves Paymax for this check. The identifier is
 * masked — we show the shape and the request, not the secret.
 */
export default function DojahRequirement({ idType, idNumber }: Props) {
  const format = ID_FORMATS[idType];
  const lookup = dojahLookup(idType, idNumber);
  const example = formatIdNumberForDisplay(idType, format.example);

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <View style={styles.heading}>
          <Info size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.title}>What Dojah requires</Text>
        </View>
        <Text style={styles.body}>{format.requirement}</Text>
        <Text style={styles.example}>Example: {example}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.heading}>
          <ShieldCheck size={16} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.title}>What we send to Dojah</Text>
        </View>
        <Row label="Provider" value="Dojah · ID data match" />
        <Row label="Dojah request" value={`${lookup.method} ${lookup.path}`} mono />
        <Row label={lookup.param} value={lookup.value || '—'} mono />
        <Row label="Paymax endpoint" value="POST /finance/kyc/checks/id-number" mono />
        <Text style={styles.foot}>
          Only this number is sent. Dojah returns your registered name and date of birth — you
          don't type them.
        </Text>
      </View>
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.md, marginBottom: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 2 },
  title: { ...Typography.labelMd, color: Colors.onSurface },
  body: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  example: {
    ...Typography.labelSm,
    color: Colors.onSurface,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, marginTop: 2 },
  rowLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flexShrink: 0 },
  rowValue: { ...Typography.labelSm, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
  },
  foot: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18, marginTop: Spacing.xs },
});
