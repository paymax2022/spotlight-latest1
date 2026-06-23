import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Wallet, CreditCard, Building2, Hash, ChevronRight, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { useInitiatePaidVote } from '@/features/voting/hooks/useVote';
import { formatAmount } from '@/features/voting/utils/voteFormatters';
import { PAYMENT_METHODS } from '@/features/voting/constants/voting.constants';
import type { PaymentMethod } from '@/features/voting/types/voting.types';

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Wallet, CreditCard, Building2, Hash,
};

export default function PaymentMethodScreen() {
  const { contestantId, contestId, votes, amount, packageId } =
    useLocalSearchParams<{ contestantId: string; contestId: string; votes: string; amount: string; packageId: string }>();
  const [selected, setSelected] = useState<PaymentMethod>('WALLET');
  const initiate = useInitiatePaidVote();

  const totalAmount = Number(amount ?? 0);
  const totalVotes  = Number(votes ?? 0);

  const handlePay = async () => {
    try {
      const result = await initiate.mutateAsync({
        contestantId: contestantId ?? '',
        contestId: contestId ?? '',
        votes: totalVotes,
        amount: totalAmount,
        packageId: packageId ?? '',
        paymentMethod: selected,
      });
      router.push(`/voting/payment-processing?reference=${result.reference}&contestantId=${contestantId}&contestId=${contestId}&votes=${votes}`);
    } catch {
      router.push('/voting/vote-failed');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Payment Method</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Summary card */}
        <View style={[styles.summaryCard, shadow1]}>
          <Text style={styles.summaryTitle}>Order Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Votes</Text>
            <Text style={styles.summaryValue}>{totalVotes} votes</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatAmount(totalAmount)}</Text>
          </View>
        </View>

        {/* Payment options */}
        <Text style={styles.sectionLabel}>Select Payment Method</Text>
        <View style={styles.methodsList}>
          {PAYMENT_METHODS.map((m) => {
            const Icon = ICON_MAP[m.icon];
            const isSelected = selected === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => setSelected(m.id as PaymentMethod)}
                style={[styles.methodCard, isSelected && styles.methodCardActive, shadow1]}
              >
                <View style={[styles.methodIcon, { backgroundColor: isSelected ? Colors.iconBgPurple : Colors.surfaceContainerHigh }]}>
                  {Icon && <Icon size={20} color={isSelected ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={1.8} />}
                </View>
                <View style={styles.methodInfo}>
                  <Text style={[styles.methodLabel, isSelected && { color: Colors.primary }]}>{m.label}</Text>
                  <Text style={styles.methodDesc}>{m.description}</Text>
                </View>
                <View style={[styles.radio, isSelected && styles.radioActive]}>
                  {isSelected && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Security note */}
        <View style={styles.secureRow}>
          <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.secureText}>Your payment is protected by 256-bit SSL encryption</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Pay ${formatAmount(totalAmount)}`}
          onPress={handlePay}
          loading={initiate.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:      { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:        { ...Typography.titleLg, color: Colors.onSurface },
  content:      { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 120 },
  summaryCard:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  summaryTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.labelMd, color: Colors.onSurface },
  totalLabel:   { ...Typography.labelLg, color: Colors.onSurface },
  totalAmount:  { ...Typography.titleLg, color: Colors.primary, fontWeight: '700' as const },
  divider:      { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  methodsList:  { gap: Spacing.sm },
  methodCard:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  methodCardActive: { borderColor: Colors.primary },
  methodIcon:   { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  methodInfo:   { flex: 1, gap: 2 },
  methodLabel:  { ...Typography.labelMd, color: Colors.onSurface },
  methodDesc:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  radio:        { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  radioActive:  { borderColor: Colors.primary },
  radioDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  secureRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  secureText:   { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  footer:       { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 34 : Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
