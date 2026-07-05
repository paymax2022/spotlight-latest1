import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check, Clock, CircleAlert } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SavingsColors, formatNaira } from '../constants/savings.constants';

export type ContributionState = 'paid' | 'pending' | 'defaulted';

interface Props {
  name:        string;
  handle?:     string;
  avatarColor: string;
  amountKobo:  number;
  state:       ContributionState;
  /** Optional trailing note (e.g. "Beneficiary"). */
  note?:       string;
}

const STATE_META: Record<ContributionState, { color: string; bg: string; Icon: typeof Check; label: string }> = {
  paid:      { color: SavingsColors.ok,     bg: SavingsColors.okBg,     Icon: Check,       label: 'Paid' },
  pending:   { color: SavingsColors.warnText, bg: SavingsColors.warnBg, Icon: Clock,       label: 'Pending' },
  defaulted: { color: SavingsColors.danger, bg: SavingsColors.dangerBg, Icon: CircleAlert, label: 'Defaulted' },
};

/** A single member's per-cycle contribution status (Ajo + group targets). */
export default function ContributionRow({ name, handle, avatarColor, amountKobo, state, note }: Props) {
  const meta = STATE_META[state];
  const initials = name.trim().slice(0, 1).toUpperCase();
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.initials}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {handle ? <Text style={styles.handle} numberOfLines={1}>{handle}{note ? ` · ${note}` : ''}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={styles.amount}>{formatNaira(amountKobo)}</Text>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <meta.Icon size={11} color={meta.color} strokeWidth={2.4} />
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  avatar: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  initials: { ...Typography.labelMd, color: '#FFFFFF' },
  name: { ...Typography.labelLg, color: SavingsColors.text },
  handle: { ...Typography.bodySm, color: SavingsColors.muted },
  amount: { ...Typography.labelMd, color: SavingsColors.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  badgeText: { ...Typography.caption, fontWeight: '600' },
});
