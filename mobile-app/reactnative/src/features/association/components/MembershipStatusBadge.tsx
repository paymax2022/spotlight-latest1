import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import {
  MEMBER_STATUS_STYLE,
  PAYMENT_STANDING_STYLE,
  INVOICE_STATUS_STYLE,
} from '../constants/association.constants';
import type { MemberStatus, PaymentStanding, InvoiceStatus } from '../types/association.types';

interface BaseProps {
  size?: 'sm' | 'md';
}

// Pill-shaped status chips: high-contrast text on a 10% tint (per DESIGN-Mobile.md).
function Pill({ label, fg, bg, size = 'md' }: { label: string; fg: string; bg: string } & BaseProps) {
  return (
    <View style={[styles.pill, size === 'sm' && styles.pillSm, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: fg }]}>{label}</Text>
    </View>
  );
}

export default function MembershipStatusBadge({ status, size }: { status: MemberStatus } & BaseProps) {
  const s = MEMBER_STATUS_STYLE[status];
  return <Pill label={s.label} fg={s.color} bg={s.bg} size={size} />;
}

export function PaymentStandingBadge({ standing, size }: { standing: PaymentStanding } & BaseProps) {
  const s = PAYMENT_STANDING_STYLE[standing];
  return <Pill label={s.label} fg={s.color} bg={s.bg} size={size} />;
}

export function InvoiceStatusBadge({ status, size }: { status: InvoiceStatus } & BaseProps) {
  const s = INVOICE_STATUS_STYLE[status];
  return <Pill label={s.label} fg={s.color} bg={s.bg} size={size} />;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingVertical: 3, paddingHorizontal: 7 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
  labelSm: { ...Typography.caption, fontWeight: '600' as const },
});
