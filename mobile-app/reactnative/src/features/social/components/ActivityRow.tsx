import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowDownToLine, ArrowUpFromLine, HandCoins, Split, Users } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SocialColors, formatNaira } from '../constants/social.constants';
import type { ActivityItem, ActivityKind } from '../types';

const KIND_META: Record<ActivityKind, { Icon: typeof HandCoins; verb: string; sign: '+' | '-' | '' }> = {
  received: { Icon: ArrowDownToLine,  verb: 'From',     sign: '+' },
  sent:     { Icon: ArrowUpFromLine,  verb: 'To',       sign: '-' },
  request:  { Icon: HandCoins,        verb: 'Requested',sign: '' },
  split:    { Icon: Split,            verb: 'Split',    sign: '' },
  pool:     { Icon: Users,            verb: 'Pool',     sign: '' },
};

export default function ActivityRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  const meta = KIND_META[item.kind];
  const declined = item.status === 'declined';
  const pending = item.status === 'pending';
  const amountColor = item.kind === 'received' ? SocialColors.ok : SocialColors.text;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={[styles.iconBox, { backgroundColor: item.avatarColor + '22' }]}>
        <meta.Icon size={18} color={item.avatarColor} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{meta.verb} {item.counterparty}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {item.note ? `${item.note} · ` : ''}{new Date(item.createdAtISO).toLocaleDateString()}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={[styles.amount, { color: declined ? SocialColors.muted : amountColor }, declined && styles.struck]}>
          {meta.sign}{formatNaira(item.amountKobo)}
        </Text>
        {pending ? <Text style={styles.pending}>Pending</Text> : declined ? <Text style={styles.declined}>Declined</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  iconBox: { width: 42, height: 42, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: SocialColors.text },
  sub: { ...Typography.bodySm, color: SocialColors.muted },
  amount: { ...Typography.labelLg },
  struck: { textDecorationLine: 'line-through' },
  pending: { ...Typography.caption, color: SocialColors.warnText },
  declined: { ...Typography.caption, color: SocialColors.danger },
});
