// ── Paymax · Admin — ApprovalCard ────────────────────────────────────────────
// A maker-checker approval: summary + maker + approve/reject actions. Actions are
// only rendered when `canAct` (the screen passes can(role,'approval.act')). Once
// acted on (status !== 'pending') it shows the resolved status + checker instead.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import StatusPill from './StatusPill';
import { APPROVAL_STATUS_STYLE, relativeTime } from '../constants/admin.constants';
import type { Approval } from '../types/admin.types';

interface Props {
  approval: Approval;
  canAct?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  approving?: boolean;
  rejecting?: boolean;
}

export default function ApprovalCard({
  approval, canAct, onApprove, onReject, approving, rejecting,
}: Props) {
  const pending = approval.status === 'pending';
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.type} numberOfLines={1}>{approval.type}</Text>
        <StatusPill status={approval.status} styleMap={APPROVAL_STATUS_STYLE} />
      </View>

      <Text style={styles.summary}>{approval.summary}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>Maker: {approval.maker}</Text>
        <Text style={styles.meta}>{relativeTime(approval.createdAt)}</Text>
      </View>
      {approval.checker ? (
        <Text style={styles.meta}>Checker: {approval.checker}</Text>
      ) : null}

      {pending && canAct ? (
        <View style={styles.actions}>
          <View style={styles.actionBtn}>
            <PrimaryButton label="Reject" variant="danger" onPress={onReject ?? (() => {})} loading={rejecting} />
          </View>
          <View style={styles.actionBtn}>
            <PrimaryButton label="Approve" onPress={onApprove ?? (() => {})} loading={approving} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.containerMargin,
    padding: Spacing.cardPadding,
    gap: Spacing.sm,
    ...shadow1,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  type: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  summary: { ...Typography.titleMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  actionBtn: { flex: 1 },
});
