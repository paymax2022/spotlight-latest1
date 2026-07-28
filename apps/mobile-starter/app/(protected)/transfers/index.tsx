// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { initiateTransfer, listBanks, resolveAccount } from '@/api/transfers.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';

export default function TransfersScreen() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'confirm' | 'success'>('form');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState('');
  const [amountNaira, setAmountNaira] = useState('');
  const [narration, setNarration] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reference: string; amount_kobo: number } | null>(null);

  const banksQuery = useQuery({ queryKey: ['banks'], queryFn: listBanks });

  const resolveMutation = useMutation({
    mutationFn: () => resolveAccount({ account_number: accountNumber.trim(), bank_code: bankCode }),
    onSuccess: (data) => { setResolvedName(data.account_name); setStep('confirm'); },
    onError: (err: any) => setError(err?.message || 'Could not resolve account'),
  });

  const transferMutation = useMutation({
    mutationFn: () => initiateTransfer({
      recipient_account: accountNumber.trim(),
      recipient_bank_code: bankCode,
      amount_kobo: Math.round(parseFloat(amountNaira) * 100),
      narration: narration.trim() || undefined,
    }),
    onSuccess: (data) => { setResult(data); setStep('success'); },
    onError: (err: any) => setError(err?.message || 'Transfer failed. Please try again.'),
  });

  const selectedBank = banksQuery.data?.find((b) => b.code === bankCode);
  const amountKobo = Math.round((parseFloat(amountNaira) || 0) * 100);

  if (step === 'success' && result) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={72} color="#00B894" />
        </View>
        <Text style={styles.successTitle}>Transfer Sent!</Text>
        <Text style={styles.successAmount}>{formatCurrency(result.amount_kobo, 'NGN')}</Text>
        <Text style={styles.successSub}>to {resolvedName}</Text>
        <Text style={styles.successRef}>Ref: {result.reference}</Text>
        <Pressable style={styles.doneBtn} onPress={() => router.replace('/(tabs)/index' as never)}>
          <Text style={styles.doneBtnText}>Back to Home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => (step === 'confirm' ? setStep('form') : router.back())}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>{step === 'confirm' ? 'Confirm Transfer' : 'Send Money'}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {step === 'form' ? (
          <>
            {/* Bank Picker */}
            <View style={styles.section}>
              <Text style={styles.fieldLabel}>Bank</Text>
              {banksQuery.isLoading ? (
                <AppLoader />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bankScroll} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
                  {(banksQuery.data ?? []).map((b) => (
                    <Pressable
                      key={b.code}
                      style={[styles.bankChip, bankCode === b.code && styles.bankChipActive]}
                      onPress={() => setBankCode(b.code)}
                    >
                      <Text style={[styles.bankChipText, bankCode === b.code && styles.bankChipTextActive]}>{b.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Account Number */}
            <View style={styles.section}>
              <Text style={styles.fieldLabel}>Account Number</Text>
              <View style={styles.inputBox}>
                <TextInput
                  style={styles.input}
                  placeholder="10-digit account number"
                  placeholderTextColor={colors.neutral.placeholder}
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  keyboardType="numeric"
                  maxLength={10}
                />
              </View>
            </View>

            {/* Amount */}
            <View style={styles.section}>
              <Text style={styles.fieldLabel}>Amount (₦)</Text>
              <View style={styles.amountBox}>
                <Text style={styles.amountSymbol}>₦</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="0.00"
                  placeholderTextColor={colors.neutral.placeholder}
                  value={amountNaira}
                  onChangeText={setAmountNaira}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {/* Narration */}
            <View style={styles.section}>
              <Text style={styles.fieldLabel}>Narration (optional)</Text>
              <View style={styles.inputBox}>
                <TextInput
                  style={styles.input}
                  placeholder="What's this for?"
                  placeholderTextColor={colors.neutral.placeholder}
                  value={narration}
                  onChangeText={setNarration}
                />
              </View>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.nextBtn, resolveMutation.isPending && styles.nextBtnDisabled]}
              disabled={resolveMutation.isPending}
              onPress={() => {
                setError(null);
                if (!bankCode) { setError('Please select a bank'); return; }
                if (accountNumber.length !== 10) { setError('Account number must be 10 digits'); return; }
                if (!amountNaira || parseFloat(amountNaira) <= 0) { setError('Please enter a valid amount'); return; }
                resolveMutation.mutate();
              }}
            >
              {resolveMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextBtnText}>Verify Account</Text>}
            </Pressable>
          </>
        ) : (
          <>
            {/* Confirm */}
            <View style={styles.confirmCard}>
              <Text style={styles.confirmLabel}>Sending to</Text>
              <Text style={styles.confirmName}>{resolvedName}</Text>
              <Text style={styles.confirmAccount}>{selectedBank?.name} · {accountNumber}</Text>
              <View style={styles.confirmDivider} />
              <Text style={styles.confirmLabel}>Amount</Text>
              <Text style={styles.confirmAmount}>{formatCurrency(amountKobo, 'NGN')}</Text>
              {narration ? <Text style={styles.confirmNarration}>"{narration}"</Text> : null}
              <View style={styles.paymentRow}>
                <Ionicons name="wallet-outline" size={18} color={colors.primary.DEFAULT} />
                <Text style={styles.paymentText}>Deducted from Paymax Wallet</Text>
              </View>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.nextBtn, transferMutation.isPending && styles.nextBtnDisabled]}
              disabled={transferMutation.isPending}
              onPress={() => { setError(null); transferMutation.mutate(); }}
            >
              {transferMutation.isPending
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.nextBtnText}>Send {formatCurrency(amountKobo, 'NGN')}</Text>
              }
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#00CEC9',
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  section: {},
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, marginBottom: 8 },
  bankScroll: { maxHeight: 48 },
  bankChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border,
  },
  bankChipActive: { backgroundColor: '#00CEC9', borderColor: '#00CEC9' },
  bankChipText: { fontSize: 13, color: colors.neutral.textMuted },
  bankChipTextActive: { color: '#fff' },
  inputBox: {
    backgroundColor: colors.neutral.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.neutral.border,
  },
  input: { fontSize: 14, color: colors.neutral.text },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.neutral.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 2, borderColor: colors.primary.DEFAULT,
  },
  amountSymbol: { fontSize: 22, fontWeight: '800', color: colors.neutral.textMuted },
  amountInput: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.neutral.text },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  nextBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 56,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary.DEFAULT, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  nextBtnDisabled: { opacity: 0.6 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  confirmCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  confirmLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  confirmName: { fontSize: 20, fontWeight: '800', color: colors.neutral.text, marginBottom: 4 },
  confirmAccount: { fontSize: 14, color: colors.neutral.textMuted, marginBottom: 16 },
  confirmDivider: { height: 1, backgroundColor: colors.neutral.border, marginBottom: 16 },
  confirmAmount: { fontSize: 32, fontWeight: '900', color: colors.primary.DEFAULT, marginBottom: 6 },
  confirmNarration: { fontSize: 14, color: colors.neutral.textMuted, fontStyle: 'italic', marginBottom: 12 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 10, marginTop: 8 },
  paymentText: { fontSize: 13, color: colors.neutral.text, fontWeight: '500' },
  successIcon: { marginBottom: 20 },
  successTitle: { fontSize: 26, fontWeight: '800', color: colors.neutral.text, marginBottom: 8 },
  successAmount: { fontSize: 36, fontWeight: '900', color: '#00B894', marginBottom: 4 },
  successSub: { fontSize: 16, color: colors.neutral.textMuted },
  successRef: { fontSize: 12, color: colors.neutral.placeholder, fontFamily: 'monospace', marginTop: 8 },
  doneBtn: { marginTop: 32, backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
