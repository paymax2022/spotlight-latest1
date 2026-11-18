import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { SocialColors, formatNaira } from '../constants/social.constants';
import { counterpartLabel, requestVerb } from '../lib/requests';
import type { MoneyRequest, RequestState } from '../types';

// One money request, from the point of view of the person looking at it.
// Same row, two meanings: an INCOMING request is money the viewer owes, so it
// reads "Requested from you" and is the actionable one; an OUTGOING request is
// money owed to them.
const STATE_META: Record<RequestState, { label: string; color: string; bg: string }> = {
  PENDING:   { label: 'Waiting',   color: SocialColors.warnText, bg: SocialColors.warnBg },
  PAID:      { label: 'Paid',      color: SocialColors.ok,       bg: SocialColors.okBg },
  DECLINED:  { label: 'Declined',  color: SocialColors.danger,   bg: SocialColors.dangerBg },
  CANCELLED: { label: 'Cancelled', color: SocialColors.muted,    bg: SocialColors.surfaceAlt },
};

export default function RequestRow({ req, onPress }: { req: MoneyRequest; onPress?: () => void }) {
  const incoming = req.direction === 'incoming';
  const meta = STATE_META[req.state];
  const Icon = incoming ? ArrowDownToLine : ArrowUpFromLine;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${requestVerb(req)} ${formatNaira(req.amountKobo)} ${meta.label}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.iconBox}>
        <Icon size={18} color={incoming ? SocialColors.danger : SocialColors.brand} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title} numberOfLines={1}>{counterpartLabel(req)}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {requestVerb(req)}
          {req.note ? ` · ${req.note}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={styles.amount}>{formatNaira(req.amountKobo)}</Text>
        <View style={[styles.chip, { backgroundColor: meta.bg }]}>
          <Text style={[styles.chipText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>
      {onPress ? <ChevronRight size={18} color={SocialColors.muted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  iconBox: { width: 42, height: 42, borderRadius: Radius.full, backgroundColor: SocialColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: SocialColors.text },
  sub: { ...Typography.bodySm, color: SocialColors.muted },
  amount: { ...Typography.labelLg, color: SocialColors.text },
  chip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  chipText: { ...Typography.caption },
});
