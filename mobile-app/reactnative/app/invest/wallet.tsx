import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useInvestWallet, useDeposit, useWithdraw } from '@/features/invest/hooks/useInvest';
import { formatNaira, nairaToKobo } from '@/features/invest/utils/format';

type Mode = 'deposit' | 'withdraw';

export default function InvestWalletScreen() {
  const wallet = useInvestWallet();
  const deposit = useDeposit();
  const withdraw = useWithdraw();
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');

  const w = wallet.data;
  const amountKobo = nairaToKobo(amount);
  const busy = deposit.isPending || withdraw.isPending;
  const max = mode === 'withdraw' ? (w?.withdrawable_cash_kobo ?? 0) : Number.MAX_SAFE_INTEGER;
  const invalid = amountKobo <= 0 || amountKobo > max;

  async function submit() {
    try {
      if (mode === 'deposit') await deposit.mutateAsync(amountKobo);
      else await withdraw.mutateAsync(amountKobo);
      setAmount('');
      Alert.alert('Success', mode === 'deposit' ? 'Funds added to your invest wallet.' : 'Withdrawal to your Paymax wallet is on its way.');
    } catch (e: any) {
      Alert.alert('Could not complete', e?.response?.data?.error ?? 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invest wallet" />
      {wallet.isLoading ? (
        <StateView kind="loading" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }} keyboardShouldPersistTaps="handled">
          <View style={[styles.balanceCard, shadow1]}>
            <Text style={styles.balanceLabel}>Available cash</Text>
            <Text style={styles.balanceValue}>{formatNaira(w?.available_cash_kobo ?? 0)}</Text>
            <View style={styles.metaRow}>
              <Meta label="Locked" value={formatNaira(w?.locked_cash_kobo ?? 0)} />
              <Meta label="Pending settlement" value={formatNaira(w?.pending_settlement_kobo ?? 0)} />
            </View>
          </View>

          <View style={styles.toggle}>
            <Pressable style={[styles.toggleBtn, mode === 'deposit' && styles.toggleActive]} onPress={() => setMode('deposit')}>
              <ArrowDownToLine size={16} color={mode === 'deposit' ? Colors.onPrimary : Colors.onSurfaceVariant} />
              <Text style={[styles.toggleText, mode === 'deposit' && styles.toggleTextActive]}>Add funds</Text>
            </Pressable>
            <Pressable style={[styles.toggleBtn, mode === 'withdraw' && styles.toggleActive]} onPress={() => setMode('withdraw')}>
              <ArrowUpFromLine size={16} color={mode === 'withdraw' ? Colors.onPrimary : Colors.onSurfaceVariant} />
              <Text style={[styles.toggleText, mode === 'withdraw' && styles.toggleTextActive]}>Withdraw</Text>
            </Pressable>
          </View>

          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>
              {mode === 'deposit' ? 'Amount to add from Paymax wallet' : 'Amount to withdraw to Paymax wallet'}
            </Text>
            <View style={styles.amountInputRow}>
              <Text style={styles.currency}>₦</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={Colors.outline}
                keyboardType="decimal-pad"
                style={styles.amountInput}
              />
            </View>
            {mode === 'withdraw' && (
              <Text style={styles.hint}>Withdrawable: {formatNaira(w?.withdrawable_cash_kobo ?? 0)}</Text>
            )}
            {amountKobo > max && mode === 'withdraw' && (
              <Text style={styles.err}>Amount exceeds your withdrawable balance.</Text>
            )}
          </View>

          <View style={{ paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg }}>
            <PrimaryButton
              label={mode === 'deposit' ? 'Add funds' : 'Withdraw'}
              onPress={submit}
              loading={busy}
              disabled={invalid || busy}
            />
          </View>

          <Text style={styles.note}>
            Your investment cash is held separately from your main Paymax wallet. Every movement is
            recorded as a double-entry ledger transaction.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  balanceCard: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  balanceLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  balanceValue: { ...Typography.headlineLg, color: Colors.onSurface, marginTop: 2 },
  metaRow: { flexDirection: 'row', marginTop: Spacing.md, gap: Spacing.md },
  metaLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaValue: { ...Typography.labelLg, color: Colors.onSurface },
  toggle: {
    flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: 4, gap: 4,
  },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.md,
  },
  toggleActive: { backgroundColor: Colors.primary },
  toggleText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  toggleTextActive: { color: Colors.onPrimary },
  amountBlock: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, alignItems: 'center' },
  amountLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  amountInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm },
  currency: { ...Typography.headlineLg, color: Colors.onSurface },
  amountInput: { ...Typography.displayLg, fontSize: 44, color: Colors.onSurface, minWidth: 120, textAlign: 'center', padding: 0 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
});
