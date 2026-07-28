import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Copy, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import CryptoStatusBadge from '@/features/crypto/components/CryptoStatusBadge';
import { useAsset, useCryptoTransaction } from '@/features/crypto/hooks/useCrypto';
import {
  formatCrypto, formatFiatObj, formatDateTime, formatPrice,
} from '@/features/crypto/utils/cryptoFormatters';
import { CRYPTO_FEE_LABEL, SIDE_LABEL } from '@/features/crypto/constants/crypto.constants';

export default function CryptoTransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tx = useCryptoTransaction(id);
  const asset = useAsset(tx.data?.symbol);
  const decimals = asset.data?.decimals ?? 8;

  if (tx.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Receipt" />
        <StateView kind="loading" message="Loading receipt…" />
      </SafeAreaView>
    );
  }
  if (tx.isError || !tx.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Receipt" />
        <StateView kind="error" title="Couldn't load receipt" message="This transaction could not be found." actionLabel="Retry" onAction={() => tx.refetch()} />
      </SafeAreaView>
    );
  }

  const t = tx.data;
  const movement = t.side === 'deposit' || t.side === 'withdraw';
  const inbound = t.side === 'buy' || t.side === 'deposit';
  const cryptoLabel = t.side === 'withdraw' ? 'Crypto sent' : inbound ? 'Crypto received' : 'Crypto sold';
  const totalLabel =
    t.side === 'buy' ? 'Total paid'
    : t.side === 'sell' ? 'Total received'
    : t.side === 'deposit' ? 'Value received'
    : 'Total sent';
  const failed = t.status === 'Failed' || t.status === 'WithdrawalFailed';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Receipt" subtitle={t.reference} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <AssetIcon symbol={t.symbol} color={t.iconColor} size={48} />
          <Text style={styles.heroTitle}>{SIDE_LABEL[t.side]} {t.assetName}</Text>
          <Text style={styles.heroAmount}>{formatCrypto(t.crypto.amount, t.symbol, decimals)}</Text>
          <CryptoStatusBadge status={t.status} />
        </View>

        {failed && t.failureReason ? (
          <View style={styles.failBox}>
            <Text style={styles.failText}>{t.failureReason}</Text>
          </View>
        ) : null}

        {/* Summary */}
        <View style={styles.card}>
          <Row label="Type" value={`${SIDE_LABEL[t.side]} ${t.symbol}`} />
          {!movement ? <Row label="Price" value={formatPrice(t.symbol, t.allInRate)} /> : null}
          <Row label={cryptoLabel} value={formatCrypto(t.crypto.amount, t.symbol, decimals)} />
          <View style={styles.divider} />
          {t.fees.filter((f) => f.amount.amount > 0).map((f) => (
            <Row key={f.type} label={CRYPTO_FEE_LABEL[f.type] ?? f.type} value={formatFiatObj(f.amount)} muted />
          ))}
          <View style={styles.divider} />
          <Row label={totalLabel} value={formatFiatObj(t.totalFiat)} emphasis />
        </View>

        {/* Status timeline */}
        <Text style={styles.sectionTitle}>Status</Text>
        <View style={styles.card}>
          {t.statusHistory.map((s, i) => (
            <View key={`${s.status}-${i}`} style={styles.timelineRow}>
              <View style={styles.timelineDotWrap}>
                <View style={[styles.timelineDot, i === t.statusHistory.length - 1 && styles.timelineDotActive]} />
                {i < t.statusHistory.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <CryptoStatusBadge status={s.status} size="sm" />
                <Text style={styles.timelineAt}>{formatDateTime(s.at)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Provider traceability */}
        <Text style={styles.sectionTitle}>Details</Text>
        <View style={styles.card}>
          <Row label="Reference" value={t.reference} copyable />
          <Row label="Date" value={formatDateTime(t.createdAt)} />
          <Row label="Provider reference" value={t.providerReference} copyable />
          <Row label="Liquidity partner" value={t.liquidityProvider} />
          <Row label="Custody partner" value={t.custodyProvider} />
        </View>

        <View style={styles.secureNote}>
          <ShieldCheck size={15} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.secureText}>
            Every order is recorded against a provider reference and a double-entry ledger record, so your balances always reconcile.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, emphasis, muted, copyable }: { label: string; value: string; emphasis?: boolean; muted?: boolean; copyable?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, emphasis && styles.rowEmphasis, muted && styles.rowMutedValue]} numberOfLines={1}>{value}</Text>
        {copyable ? <Copy size={13} color={Colors.outline} strokeWidth={2} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg, gap: 6,
  },
  heroTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  failBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  failText: { ...Typography.labelMd, color: Colors.error, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 0 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'right' },
  rowEmphasis: { ...Typography.labelLg, color: Colors.primary },
  rowMuted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowMutedValue: { color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  timelineRow: { flexDirection: 'row', gap: Spacing.md },
  timelineDotWrap: { alignItems: 'center', width: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, marginTop: 4 },
  timelineDotActive: { backgroundColor: Colors.primary },
  timelineLine: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  timelineBody: { flex: 1, gap: 4, paddingBottom: Spacing.md },
  timelineAt: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  secureNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: Spacing.xs },
  secureText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
});
