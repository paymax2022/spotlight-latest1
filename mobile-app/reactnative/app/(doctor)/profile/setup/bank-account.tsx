import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, InfoRow } from '@/features/doctor/components';
import { useProfileDraft, useSaveBankAccount, useSaveProfileDraft, useVerifyBankAccount } from '@/features/doctor/hooks';
import { BANK_LIST } from '@/features/doctor/constants';
import type { BankAccount } from '@/types/doctor.profile';

interface VerifiedAccount {
  accountName: string;
  accountNumberMasked: string;
}

export default function BankAccountScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const saveBank = useSaveBankAccount();
  const verify = useVerifyBankAccount();
  const saveDraft = useSaveProfileDraft();

  const [bankName, setBankName] = useState<string | undefined>();
  const [accountNumber, setAccountNumber] = useState('');
  // The account-holder name RETURNED by the provider (Monnify name enquiry).
  // Continue saves the account — that click is the user's affirmation.
  const [verified, setVerified] = useState<VerifiedAccount | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (draft?.bankAccount && !bankName) {
      setBankName(draft.bankAccount.bankName);
      setAccountNumber(draft.bankAccount.accountNumber);
      if (draft.bankAccount.isVerified && draft.bankAccount.accountName) {
        setVerified({
          accountName: draft.bankAccount.accountName,
          accountNumberMasked: `****${draft.bankAccount.accountNumber.slice(-4)}`,
        });
      }
    }
  }, [draft, bankName]);

  const canResolve = !!bankName && accountNumber.trim().length === 10;

  const resolve = async () => {
    const code = BANK_LIST.find((b) => b.name === bankName)?.code;
    if (!code || !bankName) {
      setError('Invalid bank selected. Please choose a bank from the list.');
      return;
    }
    setError(undefined);
    setVerified(undefined);
    try {
      const res = await verify.mutateAsync({ bankName, bankCode: code, accountNumber: accountNumber.trim() });
      if (!res.accountName) {
        setError('The bank could not confirm an account name for these details.');
        return;
      }
      setVerified({ accountName: res.accountName, accountNumberMasked: res.accountNumberMasked });
    } catch {
      setError('Could not verify account. Check the details and try again.');
    }
  };

  const handleNext = async () => {
    if (!draft || !bankName || !verified) return;
    const bankCode = BANK_LIST.find((b) => b.name === bankName)?.code;
    try {
      // Persist the payout account (the server re-resolves the name and marks
      // it verified), then record it on the wizard draft.
      const res = await saveBank.mutateAsync({ bankName, bankCode, accountNumber: accountNumber.trim() });
      const account: BankAccount = res.account
        ? res.account
        : { bankName, bankCode, accountNumber: accountNumber.trim(), accountName: verified.accountName, isVerified: true };
      await saveDraft.mutateAsync({ draft: { bankAccount: account, completedSteps: [...new Set([...draft.completedSteps, 'bank_account' as const])] } });
      router.push('/(doctor)/profile/setup/preview');
    } catch {
      setError('Could not save the verified account. Please try again.');
    }
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
          <WizardProgress current={18} total={18} label="Bank account" />

          <SectionCard title="Payout account" style={styles.card}>
            <Text style={styles.hint}>We ask the bank network who holds this account number, then show you the returned name. Continue confirms it is yours.</Text>
            <SelectField label="Bank" placeholder="Select bank" value={bankName} options={BANK_LIST.map((b) => b.name)} onChange={(name) => { setBankName(name); setVerified(undefined); }} />
            <TextInputField label="Account number (NUBAN)" placeholder="10-digit account number" value={accountNumber} onChangeText={(v) => { setAccountNumber(v.replace(/[^0-9]/g, '')); setVerified(undefined); }} keyboardType="number-pad" maxLength={10} />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <PrimaryButton
              label={verified ? 'Re-verify account' : 'Verify account'}
              onPress={resolve}
              loading={verify.isPending}
              disabled={!canResolve}
              variant="secondary"
              style={styles.verifyBtn}
            />
          </SectionCard>

          {!!verified && (
            <SectionCard title="Returned account details" style={styles.card}>
              <View style={styles.verifiedRow}>
                <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.verifiedText}>Name returned by the bank network</Text>
              </View>
              <InfoRow label="Account name" value={verified.accountName} />
              <InfoRow label="Bank" value={bankName ?? '—'} />
              <InfoRow label="Account" value={verified.accountNumberMasked} />
              <Text style={styles.hint}>If this is your account, tap Continue to confirm and save it.</Text>
            </SectionCard>
          )}

          <PrimaryButton label="Continue" onPress={handleNext} loading={saveBank.isPending || saveDraft.isPending} disabled={!verified} style={styles.btn} />
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
