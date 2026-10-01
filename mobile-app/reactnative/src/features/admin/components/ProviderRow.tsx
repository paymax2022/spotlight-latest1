// One integration's health: name + kind, status pill, latency + last-check.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import StatusPill from './StatusPill';
import { ENTITY_STATUS_STYLE, relativeTime } from '../constants/admin.constants';
import type { ProviderHealth } from '../types/admin.types';

interface Props {
  provider: ProviderHealth;
  last?: boolean;
}

export default function ProviderRow({ provider, last }: Props) {
  return (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>{provider.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {provider.kind} · {provider.latencyMs}ms · checked {relativeTime(provider.lastCheck)}
        </Text>
      </View>
      <StatusPill status={provider.status} styleMap={ENTITY_STATUS_STYLE} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  left: { flex: 1, gap: 2 },
  name: { ...Typography.bodyMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
