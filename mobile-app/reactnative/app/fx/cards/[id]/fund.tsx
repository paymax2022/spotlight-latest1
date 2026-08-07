import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import { useCard, useFundCard } from '@/features/fx/hooks/useFxCards';
import { useBalances } from '@/features/fx/hooks/useFx';
import { CARD_FUND_PRESETS } from '@/features/fx/constants/fx.constants';
import { formatMoney, parseToMinor, minorToInput } from '@/features/fx/utils/fxFormatters';
import { sanitizeMoneyInput } from '@/utils/money';

export default function FundCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: card, isLoading } = useCard(id);
  const balances = useBalances();
  const fund = useFundCard();
  const [input, setInput] = useState('');

  if (isLoading || !card) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Fund card" /><StateView kind="loading" /></SafeAreaView>;
  }

  const amount = parseToMinor(input, card.currency);
  const sourceBalance = balances.data?.find((b) => b.currency === card.currency)?.available ?? 0;
  const insufficient = amount > sourceBalance;
  const presets = CARD_FUND_PRESETS[card.currency] ?? [];
  const disabled = amount <= 0 || insufficient;

  const submit = async () => {
    await fund.mutateAsync({ id: card.id, amount });
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Fund card" subtitle={`${card.label} · •••• ${card.last4}`} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Current card balance</Text>
            <Text style={styles.summaryValue}>{formatMoney(card.balance, card.currency)}</Text>
          </View>

          <View style={styles.head}>
            <Text style={styles.label}>Amount to add</Text>
            <Text style={styles.balance}>Wallet: {formatMoney(sourceBalance, card.currency)}</Text>
          </View>
          <View style={[styles.amountRow, insufficient && styles.amountError]}>
            <CurrencyChip currency={card.currency} compact />
            <TextInput
              style={styles.amountInput}
              value={input}
              onChangeText={(v) => setInput(sanitizeMoneyInput(v))}
              placeholder="0.00"
              placeholderTextColor={Colors.outline}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={13}
              autoFocus
              accessibilityLabel="Amount to fund"
            />
          </View>
          {insufficient ? <Text style={styles.errorText}>Insufficient {card.currency} wallet balance.</Text> : null}

          {presets.length > 0 ? (
            <View style={styles.presetRow}>
              {presets.map((p) => (
                <Pressable key={p} style={styles.preset} onPress={() => setInput(minorToInput(p, card.currency))} accessibilityRole="button">
                  <Text style={styles.presetText}>{formatMoney(p, card.currency, { decimals: false })}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label={amount > 0 ? `Add ${formatMoney(amount, card.currency)}` : 'Add money'} onPress={submit} loading={fund.isPending} disabled={disabled} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  summary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  summaryLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.secondary, paddingHorizontal: Spacing.md, height: 64,
  },
  amountError: { borderColor: Colors.error },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  preset: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  presetText: { ...Typography.labelMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
