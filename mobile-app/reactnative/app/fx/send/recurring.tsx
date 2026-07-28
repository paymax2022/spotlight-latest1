import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import SegmentedTabs from '@/components/SegmentedControl';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import { useBeneficiaries, useBalances } from '@/features/fx/hooks/useFx';
import { parseToMinor, formatMoney } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

type Frequency = 'weekly' | 'monthly';

export default function RecurringPayoutScreen() {
  const { data: beneficiaries, isLoading } = useBeneficiaries();
  const balances = useBalances();
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [source, setSource] = useState<CurrencyCode>('USD');
  const [input, setInput] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [startDate, setStartDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const names = useMemo(() => (beneficiaries ?? []).map((b) => b.name), [beneficiaries]);
  const beneficiary = (beneficiaries ?? []).find((b) => b.name === beneficiaryName);
  const amount = parseToMinor(input, source);
  const ready = !!beneficiary && amount > 0 && !!startDate;

  const schedule = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        'Schedule created',
        `${formatMoney(amount, source)} to ${beneficiaryName} every ${frequency === 'weekly' ? 'week' : 'month'}, starting ${startDate}.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    }, 900);
  };

  if (isLoading) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Schedule payout" /><StateView kind="loading" /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Schedule payout" subtitle="Recurring transfer" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <SelectField label="Beneficiary" value={beneficiaryName} options={names} placeholder="Select a saved beneficiary" onChange={setBeneficiaryName} />

          <View style={styles.amountField}>
            <View style={styles.fieldHead}>
              <Text style={styles.label}>Amount each cycle</Text>
              <Text style={styles.balance}>Balance: {formatMoney(balances.data?.find((b) => b.currency === source)?.available ?? 0, source)}</Text>
            </View>
            <View style={styles.amountRow}>
              <CurrencyChip currency={source} onPress={() => setSource(source === 'USD' ? 'NGN' : 'USD')} compact />
              <TextInput style={styles.amountInput} value={input} onChangeText={setInput} placeholder="0.00" placeholderTextColor={Colors.outline} keyboardType="decimal-pad" accessibilityLabel="Recurring amount" />
            </View>
          </View>

          <Text style={styles.label}>Frequency</Text>
          <SegmentedTabs<Frequency> value={frequency} onChange={setFrequency} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />

          <View style={styles.dateField}>
            <DatePickerField label="Start date" value={startDate} onChange={setStartDate} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 2} />
          </View>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Create schedule" onPress={schedule} loading={submitting} disabled={!ready} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  amountField: { marginBottom: Spacing.md },
  fieldHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary, paddingHorizontal: Spacing.md, height: 60 },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.titleLg, color: Colors.onSurface, padding: 0 },
  dateField: { marginTop: Spacing.lg },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
