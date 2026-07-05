import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import {
  VERTICAL_META,
  CONSENT_STATUS_META,
  scopeLabel,
  formatDate,
} from '../constants/health.constants';
import type { ConsentGrant } from '../types';

/**
 * A granular, revocable consent grant row (HL-8). Surfaces grantee, scopes,
 * status, expiry and last access, with a revoke action when active.
 */
export default function ConsentToggleRow({
  grant,
  onRevoke,
  revoking,
}: {
  grant: ConsentGrant;
  onRevoke?: (id: string) => void;
  revoking?: boolean;
}) {
  const vMeta = VERTICAL_META[grant.granteeVertical];
  const sMeta = CONSENT_STATUS_META[grant.status];
  const VIcon = (Icons as unknown as Record<string, Icons.LucideIcon>)[vMeta.icon] ?? Icons.Activity;
  const isActive = grant.status === 'active';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: vMeta.iconBg }]}>
          <VIcon size={18} color={vMeta.color} strokeWidth={2} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.grantee} numberOfLines={1}>
            {grant.granteeName}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {vMeta.label} · sharing {grant.subjectName}'s data
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: sMeta.bg }]}>
          <Text style={[styles.statusText, { color: sMeta.color }]}>{sMeta.label}</Text>
        </View>
      </View>

      <View style={styles.scopes}>
        {grant.scopes.map((s) => (
          <View key={s} style={styles.chip}>
            <Text style={styles.chipText}>{scopeLabel(s)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.foot}>
          Granted {formatDate(grant.grantedAt)}
          {grant.expiresAt ? ` · expires ${formatDate(grant.expiresAt)}` : ''}
          {grant.lastAccessedAt ? ` · last read ${formatDate(grant.lastAccessedAt)}` : ''}
        </Text>
      </View>

      {isActive && onRevoke ? (
        revoking ? (
          <View style={styles.revoking}>
            <ActivityIndicator size="small" color={Colors.error} />
          </View>
        ) : (
          <PrimaryButton
            label="Revoke access"
            variant="danger"
            onPress={() => onRevoke(grant.id)}
            style={styles.revokeBtn}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  grantee: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statusPill: { paddingHorizontal: Spacing.sm + 2, paddingVertical: 4, borderRadius: Radius.full },
  statusText: { ...Typography.labelSm, fontWeight: '700' as const },
  scopes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
  },
  chipText: { ...Typography.caption, color: Colors.onSurface },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  foot: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  revokeBtn: { height: 44, marginTop: 2 },
  revoking: { height: 44, alignItems: 'center', justifyContent: 'center' },
});
