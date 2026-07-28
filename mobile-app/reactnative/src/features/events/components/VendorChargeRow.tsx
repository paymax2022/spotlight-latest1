import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ArrowDownLeft, ArrowUpRight, RotateCcw } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { EventColors, formatNaira } from '../constants/events.constants';
import type { EventWalletEntry } from '../types';

const KIND_META = {
  TOPUP:  { Icon: ArrowDownLeft, color: EventColors.ok,       bg: EventColors.okBg,   sign: '+' },
  CHARGE: { Icon: ArrowUpRight,  color: EventColors.text,     bg: EventColors.surfaceAlt, sign: '-' },
  REFUND: { Icon: RotateCcw,     color: EventColors.accent,   bg: EventColors.surfaceAlt, sign: '+' },
} as const;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

export default function VendorChargeRow({ entry }: { entry: EventWalletEntry }) {
  const meta = KIND_META[entry.type];
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: meta.bg }]}>
        <meta.Icon size={18} color={meta.color} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label} numberOfLines={1}>{entry.reference}</Text>
        <Text style={styles.sub}>{timeLabel(entry.created_at)}</Text>
      </View>
      <Text style={[styles.amount, { color: meta.sign === '+' ? EventColors.ok : EventColors.text }]}>
        {meta.sign}{formatNaira(entry.amount_kobo)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelMd, color: EventColors.text },
  sub: { ...Typography.caption, color: EventColors.muted, marginTop: 2 },
  amount: { ...Typography.labelLg },
});
