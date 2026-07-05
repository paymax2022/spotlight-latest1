import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import TextInputField from '@/components/TextInputField';
import { formatNaira } from '@/utils/money';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

const QUICK_AMOUNTS = ['1000', '2500', '5000', '10000', '20000'];

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Fee in kobo, shown beneath the field. */
  feeKobo?: number;
  /** Wallet balance in kobo; shown for wallet-source transfers. */
  balanceKobo?: number;
  error?: string;
  label?: string;
}

/** Shared amount entry: numeric field + quick pills + fee + (optional) balance. */
export default function AmountInput({
  value,
  onChange,
  feeKobo,
  balanceKobo,
  error,
  label = 'Amount',
}: Props) {
  return (
    <View>
      <TextInputField
        label={label}
        placeholder="₦0.00"
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        error={error}
      />

      <View style={styles.pillRow}>
        {QUICK_AMOUNTS.map((item) => {
          const active = value === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => onChange(item)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {formatNaira(Number(item) * 100, { decimals: false })}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.metaRow}>
        {balanceKobo != null && (
          <Text style={styles.meta}>Balance: {formatNaira(balanceKobo)}</Text>
        )}
        {feeKobo != null && (
          <Text style={[styles.meta, styles.metaRight]}>
            Fee: {feeKobo === 0 ? 'Free' : formatNaira(feeKobo)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: -Spacing.xs },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  pillActive: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  pillText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pillTextActive: { color: Colors.onPrimaryFixed },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaRight: { textAlign: 'right' },
});
