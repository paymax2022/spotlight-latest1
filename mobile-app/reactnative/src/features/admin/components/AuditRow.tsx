// ── Paymax · Admin — AuditRow ────────────────────────────────────────────────
// One audit-log line: actor + action, entity, reason, relative time.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { relativeTime } from '../constants/admin.constants';
import type { AuditEntry } from '../types/admin.types';

interface Props {
  entry: AuditEntry;
  last?: boolean;
}

export default function AuditRow({ entry, last }: Props) {
  return (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.left}>
        <Text style={styles.action} numberOfLines={1}>{entry.action}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {entry.actor} · {entry.entityType}/{entry.entityId}
        </Text>
        {entry.reason ? <Text style={styles.reason} numberOfLines={2}>{entry.reason}</Text> : null}
      </View>
      <Text style={styles.time}>{relativeTime(entry.at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  left: { flex: 1, gap: 2 },
  action: { ...Typography.labelMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  reason: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  time: { ...Typography.labelSm, color: Colors.outline },
});
