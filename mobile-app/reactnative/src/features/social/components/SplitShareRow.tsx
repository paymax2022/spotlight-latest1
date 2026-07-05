import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, Clock } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import CashtagAvatar from './CashtagAvatar';
import { SocialColors, formatNaira } from '../constants/social.constants';
import type { SplitShare } from '../types';

interface Props {
  share:    SplitShare;
  onPay?:   () => void;
  paying?:  boolean;
}

/** One participant's share of a split bill + pay action when it's your share. */
export default function SplitShareRow({ share, onPay, paying }: Props) {
  const paid = share.state === 'paid';
  return (
    <View style={styles.row}>
      <CashtagAvatar name={share.name} handle={share.handle} color={share.avatarColor} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{share.name}{share.isYou ? ' (you)' : ''}</Text>
        <Text style={styles.handle} numberOfLines={1}>{share.handle}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={styles.amount}>{formatNaira(share.amountKobo)}</Text>
        {paid ? (
          <View style={[styles.badge, { backgroundColor: SocialColors.okBg }]}>
            <Check size={11} color={SocialColors.ok} strokeWidth={2.6} />
            <Text style={[styles.badgeText, { color: SocialColors.ok }]}>Paid</Text>
          </View>
        ) : share.isYou && onPay ? (
          <Pressable onPress={onPay} disabled={paying} style={styles.payBtn}>
            <Text style={styles.payBtnText}>{paying ? 'Paying…' : 'Pay'}</Text>
          </Pressable>
        ) : (
          <View style={[styles.badge, { backgroundColor: SocialColors.warnBg }]}>
            <Clock size={11} color={SocialColors.warnText} strokeWidth={2.4} />
            <Text style={[styles.badgeText, { color: SocialColors.warnText }]}>Pending</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  name: { ...Typography.labelLg, color: SocialColors.text },
  handle: { ...Typography.bodySm, color: SocialColors.muted },
  amount: { ...Typography.labelMd, color: SocialColors.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  badgeText: { ...Typography.caption, fontWeight: '600' },
  payBtn: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: SocialColors.brand },
  payBtnText: { ...Typography.labelSm, color: '#FFFFFF' },
});
