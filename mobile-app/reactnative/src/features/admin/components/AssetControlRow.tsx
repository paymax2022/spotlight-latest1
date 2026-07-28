// ── Paymax · Admin — AssetControlRow ─────────────────────────────────────────
// One asset's trading controls: symbol/kind + fee, status pill, and inline
// enable/disable toggles for buy / sell / withdrawal. Toggles are controlled and
// disabled when the screen can't edit (no asset.config permission).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusPill from './StatusPill';
import { ENTITY_STATUS_STYLE, formatBps } from '../constants/admin.constants';
import type { AssetControl } from '../types/admin.types';

type Toggle = 'buyEnabled' | 'sellEnabled' | 'withdrawalEnabled';

interface Props {
  asset: AssetControl;
  canEdit?: boolean;
  onToggle?: (field: Toggle, next: boolean) => void;
  last?: boolean;
}

const TOGGLES: { field: Toggle; label: string }[] = [
  { field: 'buyEnabled', label: 'Buy' },
  { field: 'sellEnabled', label: 'Sell' },
  { field: 'withdrawalEnabled', label: 'Withdraw' },
];

export default function AssetControlRow({ asset, canEdit, onToggle, last }: Props) {
  return (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.head}>
        <View style={styles.left}>
          <Text style={styles.symbol} numberOfLines={1}>{asset.symbol}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {asset.kind} · fee {formatBps(asset.feeBps)}
          </Text>
        </View>
        <StatusPill status={asset.status} styleMap={ENTITY_STATUS_STYLE} />
      </View>

      <View style={styles.chips}>
        {TOGGLES.map(({ field, label }) => {
          const on = asset[field];
          return (
            <View
              key={field}
              accessibilityRole="switch"
              accessibilityState={{ checked: on, disabled: !canEdit }}
              onTouchEnd={canEdit ? () => onToggle?.(field, !on) : undefined}
              style={[styles.chip, on ? styles.chipOn : styles.chipOff, !canEdit && styles.chipDisabled]}
            >
              <Text style={[styles.chipText, on ? styles.chipTextOn : styles.chipTextOff]}>
                {label} {on ? 'On' : 'Off'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  left: { flex: 1, gap: 2 },
  symbol: { ...Typography.titleMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chips: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  chipOn: { backgroundColor: Colors.iconBgTeal, borderColor: Colors.teal },
  chipOff: { backgroundColor: Colors.surfaceContainerHigh, borderColor: Colors.outlineVariant },
  chipDisabled: { opacity: 0.5 },
  chipText: { ...Typography.labelSm },
  chipTextOn: { color: Colors.tertiaryContainer },
  chipTextOff: { color: Colors.onSurfaceVariant },
});
