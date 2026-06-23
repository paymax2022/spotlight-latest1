import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { CURRENCIES } from '../constants/fx.constants';
import { formatMoney } from '../utils/fxFormatters';
import type { WalletBalance } from '../types/fx.types';

interface Props {
  balance: WalletBalance;
  hidden?: boolean;
  onPress?: () => void;
}

/**
 * Single multi-currency wallet card (Home & Balances → Multi-currency balance
 * cards). The aggregate total uses the shared BalanceCard; this renders each
 * per-currency wallet beneath it. Standard white Level-1 card per DESIGN-Mobile.md.
 */
export default function CurrencyWalletCard({ balance, hidden, onPress }: Props) {
  const meta = CURRENCIES[balance.currency];
  const pending = balance.ledger - balance.available;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.name} wallet, balance ${formatMoney(balance.available, balance.currency)}`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.flagBox}>
        <Text style={styles.flag}>{meta.flag}</Text>
      </View>

      <View style={styles.mid}>
        <Text style={styles.code}>{meta.code}</Text>
        <Text style={styles.name} numberOfLines={1}>{meta.name}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.amount} numberOfLines={1}>
          {hidden ? '••••' : formatMoney(balance.available, balance.currency)}
        </Text>
        {pending > 0 && !hidden ? (
          <View style={styles.pendingRow}>
            <ArrowDownLeft size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.pending}>{formatMoney(pending, balance.currency)} pending</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  pressed: { opacity: 0.85 },
  flagBox: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainer,
    alignItems: 'center', justifyContent: 'center',
  },
  flag: { fontSize: 22 },
  mid: { flex: 1 },
  code: { ...Typography.labelLg, color: Colors.onSurface },
  name: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end' },
  amount: { ...Typography.titleMd, color: Colors.onSurface },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  pending: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
