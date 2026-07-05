import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { CheckCircle2, Clock, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MoneyAmount from '@/features/connect/components/wallet-MoneyAmount';
import { formatKobo } from '@/features/connect/constants/format';
import type { WalletEntry } from '@/features/connect/wallet/types';
import { useWalletEntry } from '@/features/connect/wallet/hooks';

// WL-04 — Single ledger entry receipt: amount, status, reference, running balance.
export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useWalletEntry(id ?? '');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Transaction" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load transaction" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.hero}>
            <StatusIcon status={data.status} />
            <MoneyAmount kobo={data.amountKobo} direction={data.direction} size="xl" style={styles.heroAmount} />
            <Text style={styles.heroTitle}>{data.title}</Text>
          </View>

          <View style={styles.card}>
            <Row label="Status" value={statusLabel(data.status)} valueColor={statusColor(data.status)} />
            <Row label="Reference" value={data.ref} />
            <Row label="Type" value={kindLabel(data.kind)} />
            {data.counterpartyName ? <Row label="Counterparty" value={data.counterpartyName} /> : null}
            <Row label="Balance after" value={formatKobo(data.balanceAfterKobo)} />
            <Row label="Date" value={new Date(data.createdAt).toLocaleString('en-NG')} />
            {data.note ? <Row label="Note" value={data.note} /> : null}
          </View>

          <Text style={styles.disclaimer}>
            Ledger entries are immutable. Corrections are made via reversing entries only.
          </Text>

          <PrimaryButton label="Back to wallet" variant="secondary" onPress={() => router.replace('/connect/wallet/home')} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatusIcon({ status }: { status: WalletEntry['status'] }) {
  if (status === 'completed') return <CheckCircle2 size={48} color={Colors.teal} strokeWidth={1.8} />;
  if (status === 'pending') return <Clock size={48} color={Colors.gold} strokeWidth={1.8} />;
  return <XCircle size={48} color={Colors.error} strokeWidth={1.8} />;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function statusLabel(s: WalletEntry['status']) {
  return { completed: 'Completed', pending: 'Pending', failed: 'Failed', reversed: 'Reversed' }[s];
}
function statusColor(s: WalletEntry['status']) {
  if (s === 'completed') return Colors.teal;
  if (s === 'pending') return Colors.gold;
  return Colors.error;
}
function kindLabel(k: WalletEntry['kind']) {
  return {
    fund: 'Wallet top-up', gift_sent: 'Gift sent', gift_received: 'Gift received',
    payout: 'Payout', boost: 'Boost', refund: 'Refund', reversal: 'Reversal',
  }[k];
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg },
  heroAmount: { marginTop: Spacing.xs },
  heroTitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.sm, gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  disclaimer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
