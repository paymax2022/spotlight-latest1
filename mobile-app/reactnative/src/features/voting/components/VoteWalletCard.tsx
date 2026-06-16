import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { formatAmount } from '../utils/voteFormatters';

interface Props {
  balanceKobo: number;
  currency?: string;
}

export default function VoteWalletCard({ balanceKobo, currency = 'NGN' }: Props) {
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.iconWrap}>
        <Wallet size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.info}>
        <Text style={styles.label}>Wallet Balance</Text>
        <Text style={styles.balance}>{formatAmount(balanceKobo)}</Text>
      </View>
      <Text style={styles.currency}>{currency}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    borderWidth:     1,
    borderColor:     Colors.surfaceContainerHigh,
  },
  iconWrap: {
    width:           40,
    height:          40,
    borderRadius:    Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems:      'center',
    justifyContent:  'center',
  },
  info:     { flex: 1 },
  label:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  balance:  { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '700' as const },
  currency: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
