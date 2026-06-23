import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BadgeCheck, Landmark } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView } from '@/features/doctor/components';
import { usePayoutDetails, useUpdatePayoutBankAccount } from '@/features/doctor/hooks';
import type { BankAccount } from '@/types/doctor.batch6';

// Y.12: payout bank account. Reuses the Section B BankAccount shape and its
// name-enquiry / verified affordances. Seeds from the most recent payout's saved
// account (reusing usePayoutDetails) so the screen renders instantly.
export default function BankAccountScreen() {
  const { data: payouts, isLoading, isError, refetch } = usePayoutDetails();
  const update = useUpdatePayoutBankAccount();

  const saved: BankAccount | undefined = payouts?.[0]?.bankAccount;

  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [resolved, setResolved] = useState<BankAccount | undefined>(saved);

  useEffect(() => {
    if (saved) {
      setBankName(saved.bankName);
      setAccountNumber(saved.accountNumber);
      setResolved(saved);
    }
  }, [saved]);

  const save = async () => {
    if (!bankName.trim() || accountNumber.trim().length < 10) {
      Alert.alert('Check details', 'Enter a bank and a valid 10-digit account number.');
      return;
    }
    try {
      const res = await update.mutateAsync({ bankName: bankName.trim(), accountNumber: accountNumber.trim() });
      setResolved(res.account);
      Alert.alert('Account updated', res.account.isVerified ? `Verified: ${res.account.accountName}` : 'Saved. Verification pending.');
      router.back();
    } catch {
      Alert.alert('Update failed', 'Please try again in a moment.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Bank Account" />

      {isLoading && !payouts ? (
        <StateView variant="loading" label="Loading bank account" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your bank account." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {resolved ? (
            <SectionCard title="Current payout account" style={styles.card}>
              <InfoRow label="Bank" value={resolved.bankName} />
              <InfoRow label="Account" value={`••••${resolved.accountNumber.slice(-4)}`} />
              <InfoRow label="Name" value={resolved.accountName} />
              <View style={styles.verifyRow}>
                <BadgeCheck size={16} color={resolved.isVerified ? Colors.teal : Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={[styles.verifyText, { color: resolved.isVerified ? Colors.teal : Colors.onSurfaceVariant }]}>
                  {resolved.isVerified ? 'Verified' : 'Verification pending'}
                </Text>
              </View>
            </SectionCard>
          ) : (
            <StateView variant="empty" icon={Landmark} title="No payout account" message="Add a bank account to receive payouts." />
          )}

          <SectionCard title="Update account" style={styles.card}>
            <TextInputField label="Bank name" placeholder="e.g. GTBank" value={bankName} onChangeText={setBankName} />
            <TextInputField label="Account number" placeholder="10-digit NUBAN" value={accountNumber} onChangeText={setAccountNumber} keyboardType="number-pad" maxLength={10} />
          </SectionCard>

          <PrimaryButton label="Save & verify" onPress={save} loading={update.isPending} style={styles.btn} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md, flexGrow: 1 },
  card:       { marginBottom: 0 },
  verifyRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingTop: Spacing.sm },
  verifyText: { ...Typography.labelMd, fontWeight: '600' },
  btn:        { marginTop: Spacing.sm },
});
