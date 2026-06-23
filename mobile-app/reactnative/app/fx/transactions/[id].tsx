import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Share2, FileText, TriangleAlert, ArrowLeftRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TxStatusBadge from '@/features/fx/components/TxStatusBadge';
import SummaryRow from '@/features/fx/components/SummaryRow';
import { useTransaction } from '@/features/fx/hooks/useFx';
import { RAIL_LABEL, FEE_LABEL, TX_STATUS_STYLE } from '@/features/fx/constants/fx.constants';
import { formatMoneyObj, formatDateTime, formatRate } from '@/features/fx/utils/fxFormatters';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: tx, isLoading, isError, refetch } = useTransaction(id);

  if (isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Transaction" /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !tx) return <SafeAreaView style={styles.safe}><ScreenHeader title="Transaction" /><StateView kind="error" title="Couldn't load transaction" actionLabel="Retry" onAction={() => refetch()} /></SafeAreaView>;

  const out = tx.direction === 'out';
  const Icon = tx.type === 'conversion' ? ArrowLeftRight : out ? ArrowUpRight : ArrowDownLeft;
  const shown = tx.type === 'conversion' ? tx.destination : out ? tx.source : tx.destination;

  const shareReceipt = async () => {
    const lines = [
      `Paymax FX receipt`,
      `${tx.title}`,
      `Amount: ${formatMoneyObj(tx.source)} → ${formatMoneyObj(tx.destination)}`,
      `Status: ${(TX_STATUS_STYLE[tx.status]?.label ?? tx.status)}`,
      `Reference: ${tx.reference}`,
      tx.providerRef ? `Provider ref: ${tx.providerRef}` : '',
      `Date: ${formatDateTime(tx.createdAt)}`,
    ].filter(Boolean);
    try { await Share.share({ message: lines.join('\n') }); } catch { /* dismissed */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Transaction" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={[styles.heroIcon, out ? styles.iconOut : styles.iconIn]}>
            <Icon size={24} color={out ? Colors.secondary : Colors.teal} strokeWidth={2} />
          </View>
          <Text style={styles.heroAmount}>{formatMoneyObj(shown)}</Text>
          <Text style={styles.heroTitle}>{tx.title}</Text>
          <TxStatusBadge status={tx.status} />
        </View>

        {tx.failureReason ? (
          <View style={styles.failBox}>
            <TriangleAlert size={15} color={Colors.error} strokeWidth={2} />
            <Text style={styles.failText}>{tx.failureReason}</Text>
          </View>
        ) : null}

        {/* Amounts & rate */}
        <View style={styles.card}>
          <SummaryRow label="You sent" value={formatMoneyObj(tx.source)} />
          <SummaryRow label={out ? 'Recipient got' : 'You received'} value={formatMoneyObj(tx.destination)} />
          {tx.quotedRate ? <SummaryRow label="Quoted rate" value={formatRate(tx.source.currency, tx.destination.currency, tx.quotedRate)} /> : null}
          {tx.executedRate ? <SummaryRow label="Executed rate" value={formatRate(tx.source.currency, tx.destination.currency, tx.executedRate)} /> : null}
        </View>

        {/* Fees */}
        {tx.fees.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Fees</Text>
            <View style={styles.card}>
              {tx.fees.map((f) => (
                <SummaryRow key={f.type} label={FEE_LABEL[f.type] ?? f.type} value={formatMoneyObj(f.amount)} />
              ))}
            </View>
          </>
        ) : null}

        {/* Route & references */}
        <Text style={styles.sectionLabel}>Route & references</Text>
        <View style={styles.card}>
          <SummaryRow label="Corridor" value={tx.route.corridor} />
          <SummaryRow label="Rail" value={RAIL_LABEL[tx.route.rail]} />
          <SummaryRow label="Provider" value={tx.route.provider} />
          {tx.counterparty ? <SummaryRow label="Counterparty" value={tx.counterparty} /> : null}
          {tx.narration ? <SummaryRow label="Narration" value={tx.narration} /> : null}
          <SummaryRow label="Reference" value={tx.reference} copyable />
          {tx.providerRef ? <SummaryRow label="Provider ref" value={tx.providerRef} copyable /> : null}
          <SummaryRow label="Date" value={formatDateTime(tx.createdAt)} />
        </View>

        {/* Status history */}
        <Text style={styles.sectionLabel}>Status history</Text>
        <View style={styles.card}>
          {tx.statusHistory.map((s, i) => (
            <View key={`${s.status}-${i}`} style={styles.timelineRow}>
              <View style={styles.timelineDotWrap}>
                <View style={styles.timelineDot} />
                {i < tx.statusHistory.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.timelineStatus}>{(TX_STATUS_STYLE[s.status]?.label ?? s.status)}</Text>
                <Text style={styles.timelineTime}>{formatDateTime(s.at)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Dispute */}
        {tx.status === 'successful' || tx.status === 'failed' ? (
          <Pressable style={styles.dispute} onPress={() => router.push(`/fx/transactions/dispute/${tx.id}?reference=${tx.reference}`)} accessibilityRole="button">
            <Text style={styles.disputeText}>Something wrong? Dispute this transaction</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.outlineBtn} onPress={shareReceipt} accessibilityRole="button">
          <FileText size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.outlineText}>Receipt</Text>
        </Pressable>
        <Pressable style={styles.outlineBtn} onPress={shareReceipt} accessibilityRole="button">
          <Share2 size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.outlineText}>Share</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 8, paddingVertical: Spacing.sm },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  iconIn: { backgroundColor: Colors.iconBgTeal },
  iconOut: { backgroundColor: Colors.iconBgBlue },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  heroTitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  failBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md },
  failText: { ...Typography.labelMd, color: Colors.error, flex: 1, lineHeight: 18 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: -Spacing.xs },
  timelineRow: { flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.sm },
  timelineDotWrap: { alignItems: 'center', width: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 4 },
  timelineLine: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginTop: 2 },
  timelineBody: { flex: 1, paddingBottom: Spacing.xs },
  timelineStatus: { ...Typography.labelLg, color: Colors.onSurface },
  timelineTime: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  dispute: { alignItems: 'center', paddingVertical: Spacing.sm },
  disputeText: { ...Typography.labelMd, color: Colors.secondary },
  footer: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  outlineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  outlineText: { ...Typography.labelLg, color: Colors.secondary },
});
