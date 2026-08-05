import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { getWalletLedgerEntry } from '@/api/walletLedger.api';

const TYPE_LABEL: Record<string, string> = {
  CREDIT: 'Credit', DEBIT: 'Debit', REVERSAL_CREDIT: 'Debit reversal', REVERSAL_DEBIT: 'Credit reversal',
};

function naira(kobo: number): string {
  return (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WalletTransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: entry, isLoading, isError, refetch } = useQuery({
    queryKey: ['wallet-ledger-entry', id],
    queryFn:  () => getWalletLedgerEntry(String(id)),
    enabled:  !!id,
  });

  if (isLoading) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Transaction" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (isError || !entry) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Transaction" /><StateView kind="error" title="Transaction not found" message="We couldn't load this transaction." actionLabel="Retry" onAction={() => refetch()} /></SafeAreaView>;
  }

  const isCredit = entry.direction === 'credit';
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const dateStr = when && !isNaN(when.getTime())
    ? when.toLocaleString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Transaction" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: isCredit ? Colors.iconBgTeal : Colors.iconBgPurple }]}>
            {isCredit
              ? <ArrowDownLeft size={26} color={Colors.teal} strokeWidth={2} />
              : <ArrowUpRight size={26} color={Colors.primary} strokeWidth={2} />}
          </View>
          <Text style={[styles.heroAmount, { color: isCredit ? Colors.teal : Colors.onSurface }]}>
            {isCredit ? '+' : '−'}₦{naira(entry.amountKobo)}
          </Text>
          <Text style={styles.heroLabel}>{entry.description?.trim() || (isCredit ? 'Money in' : 'Money out')}</Text>
        </View>

        <View style={[styles.card, shadow1]}>
          <Row label="Type" value={TYPE_LABEL[entry.type] ?? entry.type} />
          <Divider />
          <Row label="Direction" value={isCredit ? 'Money in' : 'Money out'} />
          <Divider />
          <Row label="Date" value={dateStr} />
          {entry.reference ? <><Divider /><Row label="Reference" value={entry.reference} /></> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}
function Divider() { return <View style={styles.rowDivider} />; }

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero:    { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  heroIcon:{ width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  heroAmount: { ...Typography.headlineMd, fontWeight: '800', marginTop: Spacing.sm },
  heroLabel:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:    { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.cardPadding },
  row:     { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.md },
  rowLabel:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue:{ ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  rowDivider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
