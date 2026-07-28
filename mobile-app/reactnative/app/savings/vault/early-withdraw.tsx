import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { TriangleAlert, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEarlyWithdrawQuote, useEarlyWithdraw } from '@/features/savings/hooks';
import { SavingsColors, formatNaira } from '@/features/savings/constants/savings.constants';

export default function EarlyWithdraw() {
  const { id, matured } = useLocalSearchParams<{ id: string; matured?: string }>();
  const vaultId = String(id);
  const isMatured = matured === '1';
  const quote = useEarlyWithdrawQuote(vaultId);
  const withdraw = useEarlyWithdraw(vaultId);

  if (quote.isLoading) return <Shell title={isMatured ? 'Withdraw' : 'Break vault'}><StateView kind="loading" message="Calculating…" /></Shell>;
  if (quote.isError || !quote.data) return <Shell title="Withdraw"><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => quote.refetch()} /></Shell>;

  const q = quote.data;
  const hasPenalty = q.penaltyKobo > 0;

  const confirm = async () => {
    try {
      await withdraw.mutateAsync();
      Alert.alert('Done', `${formatNaira(q.netKobo)} sent to your wallet.`, [{ text: 'OK', onPress: () => router.dismissAll?.() ?? router.back() }]);
    } catch {
      Alert.alert('Could not withdraw', 'Please try again.');
    }
  };

  return (
    <Shell title={isMatured ? 'Withdraw funds' : 'Break vault early'}>
      <View style={styles.body}>
        <View style={[styles.iconBox, { backgroundColor: hasPenalty ? SavingsColors.dangerBg : SavingsColors.okBg }]}>
          {hasPenalty
            ? <TriangleAlert size={32} color={SavingsColors.danger} />
            : <CircleCheck size={32} color={SavingsColors.ok} />}
        </View>
        <Text style={styles.title}>
          {isMatured ? 'Move matured savings to your wallet' : hasPenalty ? 'This vault is locked' : 'Withdraw your savings'}
        </Text>
        {hasPenalty ? (
          <Text style={styles.warn}>Breaking a locked vault early incurs a penalty. The remaining balance goes to your wallet.</Text>
        ) : null}

        <View style={styles.card}>
          <Row label="Vault balance" value={formatNaira(q.balanceKobo)} />
          {hasPenalty ? <Row label="Early-break penalty" value={`- ${formatNaira(q.penaltyKobo)}`} danger /> : null}
          <View style={styles.divider} />
          <Row label="You'll receive" value={formatNaira(q.netKobo)} bold />
        </View>

        <PrimaryButton
          label={isMatured ? 'Withdraw to wallet' : 'Confirm withdrawal'}
          variant={hasPenalty ? 'danger' : 'primary'}
          onPress={confirm}
          loading={withdraw.isPending}
        />
        <PrimaryButton label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </Shell>
  );
}

function Row({ label, value, bold, danger }: { label: string; value: string; bold?: boolean; danger?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold, danger && { color: SavingsColors.danger }]}>{value}</Text>
    </View>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, alignItems: 'center' },
  iconBox: { width: 72, height: 72, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  warn: { ...Typography.bodySm, color: SavingsColors.muted, textAlign: 'center' },
  card: { width: '100%', backgroundColor: SavingsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...Typography.bodyMd, color: SavingsColors.muted },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface },
  rowValueBold: { ...Typography.titleMd },
  divider: { height: 1, backgroundColor: SavingsColors.border, marginVertical: 4 },
});
