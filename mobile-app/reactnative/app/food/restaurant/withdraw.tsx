import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Landmark, CheckCircle2, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useEarnings, useBankAccounts, useWithdrawals, useRequestWithdrawal } from '@/features/restaurantmerchant/hooks';
import type { BankAccount, Withdrawal } from '@/features/restaurantmerchant/types';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;
const STATUS_TINT: Record<string, string> = {
  paid: Colors.tertiaryContainer,
  processing: Colors.secondary,
  pending: Colors.secondary,
  reversed: Colors.onSurfaceVariant,
  failed: Colors.error,
};

export default function WithdrawScreen() {
  const earnings = useEarnings();
  const accounts = useBankAccounts();
  const history = useWithdrawals();
  const withdraw = useRequestWithdrawal();

  const availableKobo = earnings.data?.paidOutKobo ?? 0;
  const [amount, setAmount] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default the destination to the merchant's default account (or the first saved).
  const defaultAccount = useMemo<BankAccount | undefined>(() => {
    const list = accounts.data ?? [];
    return list.find((a) => a.isDefault) ?? list[0];
  }, [accounts.data]);
  const chosenId = selectedId ?? defaultAccount?.id ?? null;

  const amountKobo = Math.round((parseFloat(amount) || 0) * 100);
  const valid = amountKobo > 0 && !!chosenId;

  const submit = () => {
    if (!valid || !chosenId) return;
    withdraw.mutate(
      { amountKobo, bankAccountId: chosenId },
      {
        onSuccess: (w) => {
          setAmount('');
          Alert.alert(
            'Withdrawal requested',
            `${naira(w.amountKobo)} is being sent to your bank. You'll see it update to "paid" once the transfer completes.`,
          );
        },
        onError: (e: any) =>
          Alert.alert('Withdrawal failed', e?.response?.data?.error ?? e?.message ?? 'Please try again.'),
      },
    );
  };

  const noAccounts = !accounts.isLoading && (accounts.data?.length ?? 0) === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Withdraw" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available in wallet</Text>
          <Text style={styles.balanceValue}>{naira(availableKobo)}</Text>
          <Text style={styles.balanceNote}>Paid-out earnings credited to your wallet.</Text>
        </View>

        {noAccounts ? (
          <View style={styles.card}>
            <Text style={styles.muted}>Add a settlement bank account before you can withdraw.</Text>
            <Pressable onPress={() => router.push('/food/restaurant/bank-accounts')} style={styles.linkBtn}>
              <Plus size={18} color={Colors.primary} />
              <Text style={styles.linkText}>Add payout account</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.section}>Amount</Text>
            <View style={styles.amountWrap}>
              <Text style={styles.currency}>₦</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={Colors.outline}
                keyboardType="numeric"
                style={styles.amountInput}
              />
            </View>

            <Text style={styles.section}>Pay to</Text>
            {accounts.isLoading ? (
              <StateView kind="loading" compact title="Loading accounts" />
            ) : (
              <View style={{ gap: Spacing.sm }}>
                {accounts.data?.map((a) => {
                  const selected = a.id === chosenId;
                  return (
                    <Pressable key={a.id} onPress={() => setSelectedId(a.id)} style={[styles.acctRow, selected && styles.acctRowSelected]}>
                      <Landmark size={18} color={selected ? Colors.primary : Colors.onSurfaceVariant} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bank}>{a.bankName}</Text>
                        <Text style={styles.muted}>{a.accountNumberMasked} · {a.accountName}</Text>
                      </View>
                      {selected ? <CheckCircle2 size={18} color={Colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <PrimaryButton
              label={valid ? `Withdraw ${naira(amountKobo)}` : 'Withdraw'}
              onPress={submit}
              loading={withdraw.isPending}
              disabled={!valid}
              style={{ marginTop: Spacing.sm }}
            />
            <Text style={styles.disclaimer}>
              Transfers are processed to your selected bank. The exact amount available is confirmed at the time of withdrawal.
            </Text>
          </>
        )}

        <Text style={styles.section}>Recent withdrawals</Text>
        {history.isLoading ? (
          <StateView kind="loading" compact title="Loading withdrawals" />
        ) : history.isError ? (
          <StateView kind="error" compact title="Couldn't load withdrawals" actionLabel="Retry" onAction={() => history.refetch()} />
        ) : (history.data?.length ?? 0) === 0 ? (
          <StateView kind="empty" compact icon="Banknote" title="No withdrawals yet"
            message="Your withdrawals to the bank will appear here." />
        ) : (
          <View style={styles.card}>
            {history.data?.map((w, i) => <WithdrawalRow key={w.id} w={w} first={i === 0} />)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function WithdrawalRow({ w, first }: { w: Withdrawal; first: boolean }) {
  const tint = STATUS_TINT[w.status] ?? Colors.onSurfaceVariant;
  return (
    <View style={[styles.wRow, !first && styles.wRowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.wAmount}>{naira(w.amountKobo)}</Text>
        <Text style={[styles.wStatus, { color: tint }]}>{w.status}</Text>
      </View>
      {w.createdAt ? <Text style={styles.wDate}>{new Date(w.createdAt).toLocaleDateString('en-NG')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  balanceCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4,
  },
  balanceLabel: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  balanceValue: { color: Colors.primary, fontSize: 28, fontWeight: '800' },
  balanceNote: { color: Colors.onSurfaceVariant, fontSize: 12 },
  section: { color: Colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: Spacing.sm },
  muted: { color: Colors.onSurfaceVariant, fontSize: 13 },
  amountWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, backgroundColor: Colors.background,
  },
  currency: { color: Colors.onSurfaceVariant, fontSize: 22, fontWeight: '700' },
  amountInput: { flex: 1, color: Colors.onSurface, fontSize: 24, fontWeight: '800', paddingVertical: 12 },
  acctRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  acctRowSelected: { borderColor: Colors.primary },
  bank: { color: Colors.onSurface, fontSize: 15, fontWeight: '700' },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm,
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 8 },
  linkText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
  disclaimer: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 4 },
  wRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  wRowBorder: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  wAmount: { color: Colors.onSurface, fontSize: 15, fontWeight: '700' },
  wStatus: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize', marginTop: 2 },
  wDate: { color: Colors.onSurfaceVariant, fontSize: 12 },
});
