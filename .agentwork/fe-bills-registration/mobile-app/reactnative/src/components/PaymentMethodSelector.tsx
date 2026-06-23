import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, CreditCard, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';

export type PaymentMethod = 'WALLET' | 'PAYSTACK';

interface Props {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
  walletBalance?: number; // naira
  amount?: number;        // naira — used to flag insufficient balance
}

export function formatNairaBalance(value?: number): string {
  return `₦${Number(value ?? 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PaymentMethodSelector({
  selected,
  onSelect,
  walletBalance,
  amount,
}: Props) {
  const balance = Number(walletBalance ?? 0);
  const needed  = Number(amount ?? 0);
  const walletInsufficient = needed > 0 && balance < needed;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Payment Method</Text>

      {/* ── Wallet ─────────────────────────────────────── */}
      <Pressable
        style={[styles.option, selected === 'WALLET' && styles.optionActive]}
        onPress={() => onSelect('WALLET')}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'WALLET' }}
      >
        <View style={[
          styles.iconWrap,
          { backgroundColor: selected === 'WALLET' ? Colors.primary : Colors.surfaceContainerLow },
        ]}>
          <Wallet size={18} color={selected === 'WALLET' ? Colors.onPrimary : Colors.primary} strokeWidth={2.2} />
        </View>

        <View style={styles.optionBody}>
          <Text style={[styles.optionLabel, selected === 'WALLET' && styles.optionLabelActive]}>
            Pay with Wallet
          </Text>
          <Text style={[
            styles.optionSub,
            walletInsufficient && selected === 'WALLET' && styles.optionSubWarn,
          ]}>
            {walletInsufficient
              ? `Insufficient — available ${formatNairaBalance(balance)}`
              : `Available: ${formatNairaBalance(balance)}`}
          </Text>
        </View>

        {selected === 'WALLET' && (
          <Check size={17} color={Colors.primary} strokeWidth={2.6} />
        )}
      </Pressable>

      {/* ── Paystack ───────────────────────────────────── */}
      <Pressable
        style={[styles.option, selected === 'PAYSTACK' && styles.optionActive]}
        onPress={() => onSelect('PAYSTACK')}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'PAYSTACK' }}
      >
        <View style={[
          styles.iconWrap,
          { backgroundColor: selected === 'PAYSTACK' ? Colors.secondary : Colors.surfaceContainerLow },
        ]}>
          <CreditCard size={18} color={selected === 'PAYSTACK' ? Colors.onSecondary : Colors.secondary} strokeWidth={2.2} />
        </View>

        <View style={styles.optionBody}>
          <View style={styles.labelRow}>
            <Text style={[styles.optionLabel, selected === 'PAYSTACK' && styles.optionLabelActive]}>
              Other Options
            </Text>
            <View style={styles.paystackBadge}>
              <Text style={styles.paystackBadgeText}>Paystack</Text>
            </View>
          </View>
          <Text style={styles.optionSub}>Card · Bank transfer · USSD</Text>
        </View>

        {selected === 'PAYSTACK' && (
          <Check size={17} color={Colors.primary} strokeWidth={2.6} />
        )}
      </Pressable>

      {selected === 'PAYSTACK' && (
        <View style={styles.paystackNote}>
          <Text style={styles.paystackNoteText}>
            You'll be redirected to Paystack to complete your payment securely.
            Return to the app once payment is confirmed.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  title: {
    ...Typography.titleMd,
    color: Colors.onSurface,
    marginBottom: Spacing.xs,
  },
  option: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             Spacing.md,
    borderWidth:     1.5,
    borderColor:     Colors.outlineVariant,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  optionActive: {
    borderColor:     Colors.primary,
    backgroundColor: Colors.primaryFixed,
  },
  iconWrap: {
    width:           38,
    height:          38,
    borderRadius:    Radius.md,
    alignItems:      'center',
    justifyContent:  'center',
  },
  optionBody: {
    flex: 1,
    gap:  2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.xs,
  },
  optionLabel: {
    ...Typography.labelMd,
    color: Colors.onSurface,
  },
  optionLabelActive: {
    color: Colors.primary,
  },
  optionSub: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
  },
  optionSubWarn: {
    color: Colors.error,
  },
  paystackBadge: {
    paddingHorizontal: 6,
    paddingVertical:   2,
    borderRadius:      Radius.full,
    backgroundColor:   '#00C3F715',
    borderWidth:       1,
    borderColor:       '#00C3F740',
  },
  paystackBadgeText: {
    fontSize:   9,
    fontWeight: '700',
    color:      '#007B5E',
    letterSpacing: 0.4,
  },
  paystackNote: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius:    Radius.md,
    padding:         Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.secondary,
  },
  paystackNoteText: {
    ...Typography.labelSm,
    color:      Colors.onSurfaceVariant,
    lineHeight: 18,
  },
});
