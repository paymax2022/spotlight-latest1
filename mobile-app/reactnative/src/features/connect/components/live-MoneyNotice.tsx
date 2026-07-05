import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  variant?: 'real-money' | 'solicitation';
  message?: string;
}

/**
 * Money-path safety notice used by gift / paid-vote surfaces.
 * - 'real-money': reminds the user this is real Naira from their wallet.
 * - 'solicitation': financial-solicitation guard (SAFETY INVARIANT §10) —
 *   never send money off-platform, gift cards, crypto, or "emergency funds".
 */
export default function LiveMoneyNotice({ variant = 'real-money', message }: Props) {
  const solicitation = variant === 'solicitation';
  const copy =
    message ??
    (solicitation
      ? 'Never send money off-platform. Requests for gift cards, crypto, bank transfers, or "emergency funds" are scams — report them.'
      : 'This uses real Naira from your Paymax wallet. The amount below will be debited immediately.');
  return (
    <View style={[styles.box, solicitation && styles.warn]}>
      <ShieldAlert
        size={16}
        color={solicitation ? Colors.error : Colors.onWarning}
        strokeWidth={2.2}
      />
      <Text style={[styles.text, solicitation && styles.warnText]}>{copy}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  warn: { backgroundColor: Colors.errorContainer, borderColor: Colors.errorContainer },
  text: { ...Typography.caption, color: Colors.onWarning, flex: 1, lineHeight: 17 },
  warnText: { color: Colors.error },
});
