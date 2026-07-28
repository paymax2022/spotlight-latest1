import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  invoiceRef:  string;
  periodLabel: string;
  total:       string;           // pre-formatted (formatKobo, display only)
  statusLabel: string;
  onPress?:    () => void;
}

// New component (Y): an invoice list row (icon + ref + period + total + status +
// chevron) for invoice history. Distinct from PayoutDetailRow (different fields,
// document icon) and no existing row renders an invoice, so this is justified.
export default function InvoiceRow({ invoiceRef, periodLabel, total, statusLabel, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && !!onPress && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Invoice ${invoiceRef}, ${total}, ${statusLabel}`}
    >
      <View style={[styles.iconBox, { backgroundColor: Colors.iconBgBlue }]}>
        <FileText size={20} color={Colors.secondary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.ref} numberOfLines={1}>{invoiceRef}</Text>
        <Text style={styles.meta} numberOfLines={1}>{periodLabel} · {statusLabel}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.total}>{total}</Text>
      </View>
      {!!onPress && <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  pressed: { opacity: 0.7 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:    { flex: 1, gap: 2 },
  ref:     { ...Typography.labelLg, color: Colors.onSurface },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  right:   { alignItems: 'flex-end' },
  total:   { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
});
