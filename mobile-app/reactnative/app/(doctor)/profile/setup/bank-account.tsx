import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, InfoRow } from '@/features/doctor/components';
import { useProfileDraft, useSaveBankAccount, useSaveProfileDraft } from '@/features/doctor/hooks';
import { BANK_LIST } from '@/features/doctor/constants';
import type { BankAccount } from '@/types/doctor.profile';

export default function BankAccountScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const saveBank = useSaveBankAccount();
  const saveDraft = useSaveProfileDraft();

  const [bankName, setBankName] = useState<string | undefined>();
  const [accountNumber, setAccountNumber] = useState('');
  const [resolved, setResolved] = useState<BankAccount | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (draft?.bankAccount && !resolved && !bankName) {
      setBankName(draft.bankAccount.bankName);
      setAccountNumber(draft.bankAccount.accountNumber);
      setResolved(draft.bankAccount);
    }
  }, [draft, resolved, bankName]);

  const canResolve = !!bankName && accountNumber.trim().length === 10;

  const resolve = async () => {
    if (!bankName) return;
    setError(undefined);
    const code = BANK_LIST.find((b) => b.name === bankName)?.code;
    try {
      const res = await saveBank.mutateAsync({ bankName, bankCode: code, accountNumber: accountNumber.trim() });
      setResolved(res.account);
    } catch {
      setError('Could not resolve account. Check the details and try again.');
    }
  };

  const handleNext = async () => {
    if (!draft) return;
    try {
      await saveDraft.mutateAsync({ draft: { bankAccount: resolved, completedSteps: [...new Set([...draft.completedSteps, 'bank_account' as const])] } });
      router.push('/(doctor)/profile/setup/tax-info');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Bank account" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Bank account" />
        <StateView variant="error" message="We could not load your bank details." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Bank account" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={18} total={19} label="Bank account" />

          <SectionCard title="Payout account" style={styles.card}>
            <Text style={styles.hint}>Where your consultation earnings are paid.</Text>
            <SelectField label="Bank" placeholder="Select bank" value={bankName} options={BANK_LIST.map((b) => b.name)} onChange={(name) => { setBankName(name); setResolved(undefined); }} />
            <TextInputField label="Account number (NUBAN)" placeholder="10-digit account number" value={accountNumber} onChangeText={(v) => { setAccountNumber(v.replace(/[^0-9]/g, '')); setResolved(undefined); }} keyboardType="number-pad" maxLength={10} />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <PrimaryButton label={resolved ? 'Re-verify account' : 'Verify account'} onPress={resolve} loading={saveBank.isPending} disabled={!canResolve} variant="secondary" style={styles.verifyBtn} />
          </SectionCard>

          {!!resolved && (
            <SectionCard title="Verified account" style={styles.card}>
              <View style={styles.verifiedRow}>
                <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.verifiedText}>Account name resolved</Text>
              </View>
              <InfoRow label="Account name" value={resolved.accountName} />
              <InfoRow label="Bank" value={resolved.bankName} />
              <InfoRow label="Account" value={resolved.accountNumber} />
            </SectionCard>
          )}

          <PrimaryButton label="Continue" onPress={handleNext} loading={saveDraft.isPending} disabled={!resolved} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  flex:         { flex: 1 },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:         { marginBottom: Spacing.md },
  hint:         { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  error:        { ...Typography.labelMd, color: Colors.error, marginBottom: Spacing.sm },
  verifyBtn:    { marginTop: Spacing.xs },
  verifiedRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  verifiedText: { ...Typography.labelMd, color: Colors.teal },
  btn:          { marginTop: Spacing.sm },
});
