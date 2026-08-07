import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import BeneficiaryRow from '@/features/fx/components/BeneficiaryRow';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import CurrencyPickerSheet from '@/features/fx/components/CurrencyPickerSheet';
import QuoteBreakdown from '@/features/fx/components/QuoteBreakdown';
import { useBeneficiaries, useBalances } from '@/features/fx/hooks/useFx';
import { buildQuote, formatMoney, parseToMinor } from '@/features/fx/utils/fxFormatters';
import { sanitizeMoneyInput } from '@/utils/money';
import { WALLET_CURRENCIES } from '@/features/fx/constants/fx.constants';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

export default function SendAmountScreen() {
  const { beneficiaryId } = useLocalSearchParams<{ beneficiaryId: string }>();
  const { data: beneficiaries, isLoading } = useBeneficiaries();
  const balances = useBalances();
  const beneficiary = beneficiaries?.find((b) => b.id === beneficiaryId);

  const [source, setSource] = useState<CurrencyCode>('USD');
  const [input, setInput] = useState('');
  const [narration, setNarration] = useState('');
  const [picker, setPicker] = useState(false);

  const amount = parseToMinor(input, source);
  const sameCurrency = beneficiary ? source === beneficiary.currency : false;

  const quote = useMemo(() => {
    if (!beneficiary || !amount) return null;
    return buildQuote({
      source, destination: beneficiary.currency, amount, amountType: 'source',
      intent: 'transfer', destinationRail: beneficiary.rail, lock: false,
    });
  }, [beneficiary, source, amount]);

  const sourceBalance = balances.data?.find((b) => b.currency === source)?.available ?? 0;
  const insufficient = quote ? quote.source.amount > sourceBalance : false;
  const disabled = !quote || amount <= 0 || insufficient;

  if (isLoading) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Send money" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (!beneficiary) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Send money" />
        <StateView kind="error" title="Beneficiary not found" message="Please pick a beneficiary again." actionLabel="Back" onAction={() => router.replace('/fx/send')} />
      </SafeAreaView>
    );
  }

  const onContinue = () => {
    if (!quote) return;
    router.push({
      pathname: '/fx/send/review',
      params: { beneficiaryId: beneficiary.id, source, amount: String(amount), narration },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Send money" subtitle={`To ${beneficiary.name}`} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.benCard}>
            <BeneficiaryRow beneficiary={beneficiary} />
          </View>

          <View style={styles.field}>
            <View style={styles.fieldHead}>
              <Text style={styles.fieldLabel}>You send</Text>
              <Text style={styles.balance}>Balance: {formatMoney(sourceBalance, source)}</Text>
            </View>
            <View style={[styles.amountRow, insufficient && styles.amountError]}>
              <CurrencyChip currency={source} onPress={() => setPicker(true)} />
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
                accessibilityLabel="Amount to send"
              />
            </View>
            {insufficient ? <Text style={styles.errorText}>Insufficient {source} balance.</Text> : null}
          </View>

          {quote && !sameCurrency ? (
            <View style={styles.quoteWrap}>
              <Text style={styles.quoteLabel}>Embedded FX quote</Text>
              <QuoteBreakdown quote={quote} showRoute />
            </View>
          ) : quote && sameCurrency ? (
            <View style={styles.sameCard}>
              <Text style={styles.sameText}>Recipient gets {formatMoney(quote.destination.amount, beneficiary.currency)} — same-currency transfer, no FX.</Text>
            </View>
          ) : (
            <StateView kind="empty" icon="Send" title="Enter an amount" message="We'll show the all-in cost before you authorize." compact />
          )}

          <TextInputField
            label="Narration / reference (optional)"
            value={narration}
            onChangeText={setNarration}
            placeholder="e.g. Vendor settlement"
            maxLength={120}
          />
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Review payout" onPress={onContinue} disabled={disabled} />
        </SafeAreaView>
      </KeyboardAvoidingView>

      <CurrencyPickerSheet
        visible={picker}
        title="Send from"
        value={source}
        options={WALLET_CURRENCIES}
        balances={balances.data}
        onSelect={setSource}
        onClose={() => setPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  benCard: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, marginBottom: Spacing.md,
  },
  field: { marginBottom: Spacing.md },
  fieldHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.secondary, paddingHorizontal: Spacing.md, height: 64,
  },
  amountError: { borderColor: Colors.error },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  quoteWrap: { marginBottom: Spacing.md },
  quoteLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  sameCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  sameText: { ...Typography.bodyMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
