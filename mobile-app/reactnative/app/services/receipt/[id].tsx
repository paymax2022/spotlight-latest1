import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, ActivityIndicator, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Clock, ArrowLeft, Share2 } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { formatNaira } from '@/utils/money';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getReceipt } from '@/api/transactions.api';

const STATUS_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  SUCCESSFUL: { icon: <CheckCircle2 size={48} color="#16A34A" strokeWidth={1.8} />, color: '#16A34A', label: 'Payment Successful' },
  FAILED:     { icon: <XCircle      size={48} color={Colors.error} strokeWidth={1.8} />, color: Colors.error, label: 'Payment Failed' },
  REFUNDED:   { icon: <CheckCircle2 size={48} color={Colors.teal} strokeWidth={1.8} />, color: Colors.teal, label: 'Refunded' },
  PROCESSING: { icon: <Clock        size={48} color={Colors.secondary} strokeWidth={1.8} />, color: Colors.secondary, label: 'Processing…' },
  PENDING:    { icon: <Clock        size={48} color={Colors.outline} strokeWidth={1.8} />, color: Colors.outline, label: 'Pending' },
};

const SERVICE_ROUTES: Record<string, string> = {
  AIRTIME: '/services/airtime',
  DATA: '/services/data',
  ELECTRICITY: '/services/electricity',
  CABLE_TV: '/services/cable-tv',
  EDUCATION: '/services/education',
};

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

function serviceLabel(serviceType?: string) {
  return serviceType ? serviceType.replace('_', ' ') : 'PAYMENT';
}

function statusMessage(status: string, serviceType?: string) {
  if (status === 'SUCCESSFUL') return `${serviceLabel(serviceType)} payment has been processed.`;
  if (status === 'FAILED') return 'The payment could not be completed. You can try again from the same service.';
  if (status === 'REFUNDED') return 'This payment has been refunded to your wallet.';
  if (status === 'PROCESSING' || status === 'PENDING') return 'Provider confirmation is still in progress. Refresh this receipt for the latest status.';
  return 'Payment status is being reconciled.';
}

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: receipt, isLoading, isError, refetch } = useQuery({
    queryKey: ['receipt', id],
    queryFn:  () => getReceipt(id ?? ''),
    enabled:  !!id,
  });

  const status = receipt?.status ?? 'PROCESSING';
  const meta   = STATUS_META[status] ?? STATUS_META.PROCESSING;
  const isPrepaidElectricity =
    receipt?.serviceType === 'ELECTRICITY' && /prepaid/i.test(receipt.productName ?? '');
  const isMissingPrepaidToken = isPrepaidElectricity
    && (receipt?.status === 'SUCCESSFUL' || receipt?.status === 'PENDING')
    && !receipt?.token;

  const handleShare = async () => {
    if (!receipt) return;
    const text = [
      `Paymax Receipt`,
      `Service: ${receipt.serviceType}`,
      `Status: ${receipt.status}`,
      `Amount: ${formatNaira(receipt.amount)}`,
      `Reference: ${receipt.reference}`,
      receipt.token ? `Token: ${receipt.token}` : null,
      `Date: ${new Date(receipt.createdAt).toLocaleString('en-NG')}`,
    ].filter(Boolean).join('\n');
    await Share.share({ message: text });
  };

  const handleRepeatPayment = () => {
    const route = SERVICE_ROUTES[receipt?.serviceType ?? ''] ?? '/services/bills';
    router.push(route as never);
  };

  const primaryActionLabel = receipt?.status === 'FAILED' ? 'Try Again' : 'Repeat Payment';
  const canRepeatPayment = !!receipt && receipt.status !== 'REFUNDED' && receipt.status !== 'REVERSED';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.replace('/(tabs)/home')} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Receipt</Text>
        <Pressable onPress={handleShare} style={styles.iconBtn} disabled={!receipt}>
          <Share2 size={21} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading receipt…</Text>
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load receipt.</Text>
          <PrimaryButton label="Retry" onPress={() => refetch()} style={{ marginTop: Spacing.lg, width: 160 }} fullWidth={false} />
        </View>
      ) : receipt ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Status banner */}
          <LinearGradient
            colors={status === 'SUCCESSFUL' ? ['#16A34A', '#15803D'] : status === 'FAILED' ? [Colors.error, '#B91C1C'] : ['#0051D5', Colors.primaryContainer]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.banner}
          >
            {meta.icon}
            <Text style={styles.bannerTitle}>{meta.label}</Text>
            <Text style={styles.bannerAmount}>{formatNaira(receipt.totalAmount)}</Text>
            <Text style={styles.bannerRef}>Ref: {receipt.reference}</Text>
            <Text style={styles.bannerMessage}>{statusMessage(receipt.status, receipt.serviceType)}</Text>
          </LinearGradient>

          {/* Token box for prepaid electricity */}
          {receipt.token ? (
            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>Electricity Token</Text>
              <Text style={styles.tokenValue}>{receipt.token}</Text>
              {receipt.units && <Text style={styles.tokenUnits}>{receipt.units} units</Text>}
            </View>
          ) : null}

          {/* Details */}
          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>Transaction Details</Text>
            <View style={styles.divider} />
            <Row label="Service"    value={receipt.serviceType?.replace('_', ' ')} />
            <Row label="Provider"   value={receipt.providerName} />
            <Row label="Provider Route"    value={receipt.providerRoute} />
            <Row label="Provider Attempts" value={receipt.providerAttempts} />
            <Row label="Product"    value={receipt.productName} />
            <Row label="Customer"   value={receipt.customerName} />
            <Row label="Account"    value={receipt.customerIdentifier} />
            <Row label="Amount"     value={formatNaira(receipt.amount)} />
            <Row label="Charges"    value={formatNaira(receipt.charges)} />
            <Row label="Total Paid" value={formatNaira(receipt.totalAmount)} />
            <Row label="Status"     value={receipt.status} />
            <Row label="Date"       value={new Date(receipt.createdAt).toLocaleString('en-NG')} />
            <Row label="Reference"  value={receipt.reference} mono />
          </View>

          {receipt.supportMessage && (
            <View style={styles.supportBox}>
              <Text style={styles.supportText}>{receipt.supportMessage}</Text>
            </View>
          )}

          {isMissingPrepaidToken && (
            <View style={styles.tokenPendingBox}>
              <Text style={styles.tokenPendingLabel}>Token Pending</Text>
              <Text style={styles.tokenPendingText}>Your electricity token is being generated. Check back in a few minutes or view transaction history.</Text>
            </View>
          )}

          <View style={styles.actions}>
            {canRepeatPayment && (
              <View style={styles.actionRow}>
                <PrimaryButton label={primaryActionLabel} onPress={handleRepeatPayment} fullWidth={false} style={styles.actionButton} />
                <PrimaryButton label="Share Receipt" variant="secondary" onPress={handleShare} fullWidth={false} style={styles.actionButton} />
              </View>
            )}
            <PrimaryButton label="Go to Home"       onPress={() => router.replace('/(tabs)/home')} />
            <PrimaryButton label="View Transactions" variant="secondary" onPress={() => router.push('/services/transactions' as never)} />
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  topBar:     { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn:    { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle:   { ...Typography.titleLg, color: Colors.primary },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  loadingText:{ ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
  errorText:  { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  banner:     { borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  bannerTitle:{ ...Typography.titleLg, color: Colors.onPrimary, marginTop: Spacing.sm },
  bannerAmount:{ fontSize: 32, fontWeight: '800', color: Colors.onPrimary, letterSpacing: 0 },
  bannerRef:  { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  bannerMessage:{ ...Typography.bodySm, color: 'rgba(255,255,255,0.82)', textAlign: 'center', marginTop: Spacing.xs },
  tokenBox:   { backgroundColor: Colors.primaryContainer, borderRadius: Radius.xl, padding: Spacing.cardPadding, alignItems: 'center', marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.primary },
  tokenLabel: { ...Typography.labelSm, color: Colors.primary, marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 1 },
  tokenValue: { fontSize: 22, fontWeight: '800', color: Colors.onPrimary, letterSpacing: 4, textAlign: 'center' },
  tokenUnits: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  card:       { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  cardTitle:  { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  divider:    { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  row:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.xs, gap: Spacing.md },
  rowLabel:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue:   { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  mono:       { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12 },
  tokenPendingBox: { backgroundColor: 'rgba(234,179,8,0.10)', borderRadius: Radius.xl, padding: Spacing.cardPadding, alignItems: 'center', marginBottom: Spacing.lg, borderWidth: 1, borderColor: '#D97706' },
  tokenPendingLabel: { ...Typography.labelSm, color: '#D97706', marginBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 1 },
  tokenPendingText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  supportBox: { backgroundColor: Colors.iconBgBlue, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  supportText:{ ...Typography.bodyMd, color: Colors.secondary },
  actions:    { gap: Spacing.sm, marginBottom: Spacing.lg },
  actionRow:  { flexDirection: 'row', gap: Spacing.sm },
  actionButton:{ flex: 1 },
});
