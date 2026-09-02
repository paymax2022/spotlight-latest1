import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, CheckCircle2, Clock, Receipt, RefreshCw, XCircle } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { formatNaira } from '@/utils/money';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getTransactionById, retryTransaction } from '@/api/transactions.api';
import { getErrorMessage } from '@/utils/errorMapper';
import { TransactionStatus } from '@/types/transaction';
import { HomeMenuButton } from '@/components/HomeMenu';

const STATUS_COLOR: Record<TransactionStatus, string> = {
  SUCCESSFUL: '#16A34A',
  FAILED:     Colors.error,
  REFUNDED:   Colors.teal,
  REVERSED:   Colors.teal,
  PROCESSING: Colors.secondary,
  PENDING:    Colors.outline,
};

const SERVICE_ROUTES: Record<string, string> = {
  AIRTIME: '/services/airtime',
  DATA: '/services/data',
  ELECTRICITY: '/services/electricity',
  CABLE_TV: '/services/cable-tv',
  EDUCATION: '/services/education',
};

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function statusSummary(status: TransactionStatus) {
  if (status === 'SUCCESSFUL') return 'This payment was processed successfully.';
  if (status === 'FAILED') return 'This payment failed before provider completion.';
  if (status === 'REFUNDED') return 'This payment was refunded to your wallet.';
  if (status === 'REVERSED') return 'This wallet debit was reversed.';
  return 'Provider confirmation is still in progress.';
}

function StatusIcon({ status, color }: { status: TransactionStatus; color: string }) {
  if (status === 'SUCCESSFUL' || status === 'REFUNDED' || status === 'REVERSED') {
    return <CheckCircle2 size={34} color={color} strokeWidth={1.8} />;
  }
  if (status === 'FAILED') return <XCircle size={34} color={color} strokeWidth={1.8} />;
  return <Clock size={34} color={color} strokeWidth={1.8} />;
}

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc     = useQueryClient();

  const { data: tx, isLoading, isError, refetch } = useQuery({
    queryKey: ['transaction', id],
    queryFn:  () => getTransactionById(id ?? ''),
    enabled:  !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PROCESSING' || status === 'PENDING' ? 5000 : false;
    },
  });

  const { mutate: retry, isPending: retrying, error: retryError } = useMutation({
    mutationFn: retryTransaction,
    onSuccess: ({ transactionId }) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      router.push(`/services/receipt/${transactionId}` as never);
    },
  });

  const statusClr = tx ? (STATUS_COLOR[tx.status] ?? Colors.outline) : Colors.outline;
  const repeatRoute = tx ? SERVICE_ROUTES[tx.serviceType] : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/services/transactions')} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Transaction Detail</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => refetch()} style={styles.iconBtn}>
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
          <HomeMenuButton />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load transaction.</Text>
          <PrimaryButton label="Retry" onPress={() => refetch()} style={{ marginTop: Spacing.lg, width: 160 }} fullWidth={false} />
        </View>
      ) : tx ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Amount header */}
          <View style={[styles.amountCard, shadow1]}>
            <View style={[styles.statusIcon, { backgroundColor: `${statusClr}18` }]}>
              <StatusIcon status={tx.status} color={statusClr} />
            </View>
            <Text style={[styles.status, { color: statusClr }]}>{tx.status}</Text>
            <Text style={styles.amount}>{formatNaira(tx.totalAmount)}</Text>
            <Text style={styles.ref}>{tx.reference}</Text>
            <Text style={styles.statusSummary}>{statusSummary(tx.status)}</Text>
          </View>

          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>Details</Text>
            <View style={styles.divider} />
            <Row label="Service"     value={tx.serviceType?.replace('_', ' ')} />
            <Row label="Provider"    value={tx.providerName} />
            <Row label="Provider Route" value={tx.providerRoute ?? 'Automatic failover'} />
            <Row label="Provider Attempts" value={tx.providerAttempts} />
            <Row label="Product"     value={tx.productName} />
            <Row label="Account"     value={tx.customerIdentifier} />
            <Row label="Amount"      value={formatNaira(tx.amount)} />
            <Row label="Charges"     value={formatNaira(tx.charges)} />
            <Row label="Total Paid"  value={formatNaira(tx.totalAmount)} />
            <Row label="Date"        value={new Date(tx.createdAt).toLocaleString('en-NG')} />
            {tx.token && <Row label="Token"  value={tx.token} />}
            {tx.units && <Row label="Units"  value={tx.units} />}
          </View>

          {retryError && <Text style={styles.apiError}>{getErrorMessage(retryError)}</Text>}

          <View style={styles.actions}>
            <PrimaryButton
              label="View Receipt"
              onPress={() => router.push(`/services/receipt/${tx.id}` as never)}
            />
            {tx.status === 'SUCCESSFUL' && repeatRoute && (
              <PrimaryButton
                label="Repeat Payment"
                variant="secondary"
                onPress={() => router.push(repeatRoute as never)}
              />
            )}
            {(tx.status === 'FAILED') && (
              <PrimaryButton
                label={retrying ? 'Retrying…' : 'Retry Transaction'}
                variant="secondary"
                loading={retrying}
                onPress={() => retry(tx.id)}
              />
            )}
            {(tx.status === 'PROCESSING' || tx.status === 'PENDING') && (
              <View style={styles.processingBox}>
                <ActivityIndicator size="small" color={Colors.secondary} />
                <Text style={styles.processingText}>Transaction is being processed. This page refreshes automatically.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  topBar:      { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn:     { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle:    { ...Typography.titleLg, color: Colors.primary },
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  errorText:   { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  amountCard:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  statusIcon:  { width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  status:      { ...Typography.labelMd, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  amount:      { fontSize: 36, fontWeight: '800', color: Colors.onSurface, letterSpacing: 0 },
  ref:         { ...Typography.labelSm, color: Colors.outline },
  statusSummary:{ ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  divider:     { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs, gap: Spacing.md },
  rowLabel:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue:    { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  apiError:    { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginBottom: Spacing.md },
  actions:     { gap: Spacing.sm, marginBottom: Spacing.lg },
  processingBox:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.md },
  processingText:{ ...Typography.labelSm, color: Colors.secondary, flex: 1 },
});
