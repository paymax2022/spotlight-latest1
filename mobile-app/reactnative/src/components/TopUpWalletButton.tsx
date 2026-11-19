import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { router, type Href } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';

/**
 * The escape hatch shown wherever a wallet debit is refused for insufficient
 * balance: a compact pill that opens the funding flow for that wallet.
 * `/wallet/add` funds the NGN Paymax wallet; FX currency wallets fund through
 * `/fx/receive` and the invest wallet through `/invest/wallet`.
 */
export default function TopUpWalletButton({
  label = 'Top up wallet',
  route = '/wallet/add',
  style,
}: {
  label?: string;
  route?: Href;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={() => router.push(route)}
      style={[styles.btn, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Plus size={15} color={Colors.primary} strokeWidth={2.4} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryFixed,
    borderWidth: 1,
    borderColor: Colors.primaryContainer,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  text: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
});