// ── Insurance (live) — policy / claim status pills ──────────────────────────
// Statuses come straight off the contract (`pending|active|expired|cancelled|
// lapsed`, `submitted|under_review|approved|rejected|paid`), so this is the one
// place they become words and colour.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '../../constants/insurance.constants';
import type { ClaimStatus, PolicyStatus } from '../../live/types';

type Variant = 'ok' | 'warn' | 'bad' | 'neutral';

const POLICY: Record<PolicyStatus, { label: string; variant: Variant }> = {
  active: { label: 'Active', variant: 'ok' },
  pending: { label: 'Activating', variant: 'warn' },
  expired: { label: 'Expired', variant: 'neutral' },
  lapsed: { label: 'Lapsed', variant: 'bad' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

const CLAIM: Record<ClaimStatus, { label: string; variant: Variant }> = {
  submitted: { label: 'Submitted', variant: 'neutral' },
  under_review: { label: 'Under review', variant: 'warn' },
  approved: { label: 'Approved', variant: 'ok' },
  rejected: { label: 'Declined', variant: 'bad' },
  paid: { label: 'Paid out', variant: 'ok' },
};

export function policyStatusLabel(status: PolicyStatus): string {
  return POLICY[status]?.label ?? 'Unknown';
}

export function claimStatusLabel(status: ClaimStatus): string {
  return CLAIM[status]?.label ?? 'Unknown';
}

export default function StatusPill({
  status,
  kind = 'policy',
}: {
  status: PolicyStatus | ClaimStatus;
  kind?: 'policy' | 'claim';
}) {
  const entry =
    kind === 'claim'
      ? CLAIM[status as ClaimStatus]
      : POLICY[status as PolicyStatus];
  const { label, variant } = entry ?? { label: 'Unknown', variant: 'neutral' as Variant };

  return (
    <View style={[styles.pill, VARIANT_BG[variant]]}>
      <View style={[styles.dot, VARIANT_DOT[variant]]} />
      <Text style={[styles.label, VARIANT_FG[variant]]}>{label}</Text>
    </View>
  );
}

const VARIANT_BG: Record<Variant, { backgroundColor: string }> = {
  ok: { backgroundColor: InsuranceColors.okBg },
  warn: { backgroundColor: Colors.iconBgGold },
  bad: { backgroundColor: Colors.errorContainer },
  neutral: { backgroundColor: Colors.surfaceContainerHigh },
};

const VARIANT_FG: Record<Variant, { color: string }> = {
  ok: { color: Colors.tertiaryContainer },
  warn: { color: InsuranceColors.warnText },
  bad: { color: Colors.error },
  neutral: { color: Colors.onSurfaceVariant },
};

const VARIANT_DOT: Record<Variant, { backgroundColor: string }> = {
  ok: { backgroundColor: InsuranceColors.ok },
  warn: { backgroundColor: InsuranceColors.warn },
  bad: { backgroundColor: Colors.error },
  neutral: { backgroundColor: Colors.outline },
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
});
