import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, CreditCard, Landmark, Building2, Banknote, Check, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useStaysStore } from '@/features/stays/store';
import { StaysColors } from '@/features/stays/constants/stays.constants';
import type { PaymentMethod } from '@/features/stays/types';

const METHODS: { key: PaymentMethod; label: string; desc: string; icon: React.ComponentType<any> }[] = [
  { key: 'wallet', label: 'Pay with wallet', desc: 'Instant, no card. Top up in-flow if needed.', icon: Wallet },
  { key: 'card', label: 'Card / bank transfer', desc: 'Secure payment via Paystack.', icon: CreditCard },
  { key: 'transfer', label: 'Bank transfer', desc: 'Transfer to a one-time virtual account.', icon: Landmark },
  { key: 'pay_at_property', label: 'Pay at property', desc: 'Confirmed with a wallet hold; pay at the hotel.', icon: Building2 },
  { key: 'deposit', label: 'Deposit + balance', desc: 'Pay part now, rest at check-in.', icon: Banknote },
];

export default function PaymentMethodScreen() {
  const { paymentMethod, setPaymentMethod } = useStaysStore();

  const next = () => {
    if (paymentMethod === 'wallet' || paymentMethod === 'card' || paymentMethod === 'transfer') {
      router.push('/stays/book/wallet-pay');
    } else {
      router.push('/stays/book/deposit-terms');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payment method" subtitle="Step 4 of 5" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {METHODS.map((m) => {
          const Icon = m.icon;
          const on = paymentMethod === m.key;
          return (
            <Pressable key={m.key} style={[styles.card, on && styles.cardOn]} onPress={() => setPaymentMethod(m.key)}>
              <View style={styles.iconBox}><Icon size={20} color={StaysColors.brand} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{m.label}</Text>
                <Text style={styles.desc}>{m.desc}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
              </View>
            </Pressable>
          );
        })}

        <View style={styles.assure}>
          <Text style={styles.assureText}>
            Your money is held — not charged — until the hotel confirms. If the booking fails, the hold is released automatically with no debit.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={paymentMethod === 'pay_at_property' || paymentMethod === 'deposit' ? 'Review terms' : 'Continue to pay'}
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.md },
  cardOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  assure: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  assureText: { ...Typography.bodySm, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
