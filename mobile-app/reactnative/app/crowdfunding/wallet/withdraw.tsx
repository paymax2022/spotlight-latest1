import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Landmark, FileUp, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useCampaignWallet, useBankAccounts, useSubmitWithdrawal } from '@/features/crowdfunding/hooks/useExtras';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function WithdrawScreen() {
  const wallet = useCampaignWallet();
  const banks = useBankAccounts();
  const submit = useSubmitWithdrawal();

  const [amountText, setAmountText] = useState('');
  const [bankId, setBankId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState(false);
  const [done, setDone] = useState(false);

  const available = wallet.data?.availableKobo ?? 0;
  const amountKobo = amountText ? Number(amountText.replace(/[^0-9]/g, '')) * 100 : 0;
  const over = amountKobo > available;
  const defaultBank = banks.data?.find((b) => b.isDefault)?.id ?? null;
  const selectedBank = bankId ?? defaultBank;
  const valid = amountKobo > 0 && !over && selectedBank && reason.trim().length > 2;

  const onSubmit = () => {
    if (!selectedBank) return;
    submit.mutate(
      { campaignId: wallet.data?.campaignId ?? 'my1', amountKobo, bankAccountId: selectedBank, reason: reason.trim(), evidenceLabel: evidence ? 'evidence.pdf' : null },
      { onSuccess: () => setDone(true) },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Withdrawal submitted" showBack={false} />
        <StateView
          kind="empty"
          icon="Clock"
          title="Request submitted for review"
          message={`Your withdrawal of ${formatNaira(amountKobo)} is pending admin approval. You'll be notified once it's processed — usually within 24 hours.`}
          actionLabel="Back to wallet"
          onAction={() => router.dismissTo('/crowdfunding/wallet')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request withdrawal" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.availCard}>
            <Text style={styles.availLabel}>Available to withdraw</Text>
            <Text style={styles.availValue}>{formatNaira(available)}</Text>
          </View>

          <Text style={styles.label}>Amount</Text>
          <View style={[styles.amountWrap, over && styles.amountErr]}>
            <Text style={styles.naira}>₦</Text>
            <TextInput style={styles.amountInput} placeholder="0" placeholderTextColor={Colors.outline} keyboardType="number-pad" value={amountText} onChangeText={(t) => setAmountText(t.replace(/[^0-9]/g, ''))} />
            <Pressable onPress={() => setAmountText(String(Math.round(available / 100)))} hitSlop={8}><Text style={styles.max}>MAX</Text></Pressable>
          </View>
          {over && <Text style={styles.err}>Amount exceeds your available balance.</Text>}

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Destination bank</Text>
          {banks.isLoading ? (
            <StateView kind="loading" compact />
          ) : (banks.data ?? []).map((b) => {
            const active = selectedBank === b.id;
            return (
              <Pressable key={b.id} style={[styles.bank, active && styles.bankActive]} onPress={() => setBankId(b.id)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={styles.bankIcon}><Landmark size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bankName}>{b.bankName} {b.accountNumberMasked}</Text>
                  <Text style={styles.bankSub}>{b.accountName}{b.isDefault ? ' · Default' : ''}</Text>
                </View>
                {active && <Check size={18} color={Colors.primary} strokeWidth={2.6} />}
              </Pressable>
            );
          })}

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Reason for withdrawal</Text>
          <TextInput style={styles.reason} placeholder="e.g. Pay supplier for borehole drilling" placeholderTextColor={Colors.outline} value={reason} onChangeText={setReason} multiline textAlignVertical="top" />

          <Pressable style={styles.evidenceRow} onPress={() => setEvidence((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: evidence }}>
            <View style={[styles.checkbox, evidence && styles.checkboxOn]}>{evidence && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}</View>
            <FileUp size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.evidenceText}>Attach supporting evidence (recommended)</Text>
          </Pressable>

          <View style={styles.noteRow}>
            <Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.note}>Withdrawals require KYC verification and admin approval before disbursement.</Text>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={amountKobo > 0 ? `Request ${formatNaira(amountKobo)}` : 'Request withdrawal'} onPress={onSubmit} disabled={!valid} loading={submit.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  availCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg, alignItems: 'center' },
  availLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  availValue: { ...Typography.headlineMd, color: Colors.onSurface },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  amountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, height: 64, gap: Spacing.sm },
  amountErr: { borderColor: Colors.error },
  naira: { ...Typography.headlineMd, color: Colors.onSurfaceVariant },
  amountInput: { flex: 1, ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  max: { ...Typography.labelMd, color: Colors.secondary },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: 6 },
  bank: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  bankActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  bankIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  bankName: { ...Typography.labelLg, color: Colors.onSurface },
  bankSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  reason: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 80, ...Typography.bodyMd, color: Colors.onSurface },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  checkbox: { width: 20, height: 20, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  evidenceText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  noteRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: Spacing.md },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
