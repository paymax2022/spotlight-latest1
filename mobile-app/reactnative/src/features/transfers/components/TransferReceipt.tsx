import React from 'react';
import { View, Text, StyleSheet, Share, Pressable } from 'react-native';
import { CheckCircle, Clock, Share2 } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import { formatNaira } from '@/utils/money';
import { shadow1 } from '@/constants/shadows';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { TransferReceiptData } from '../types';

interface Props {
  receipt: TransferReceiptData;
  onDone: () => void;
}

const PENDING_STATUSES = new Set(['pending', 'processing', 'funds_reserved']);

function statusLabel(status: string): string {
  switch (status) {
    case 'successful':
      return 'Successful';
    case 'funds_reserved':
      return 'Funds reserved';
    case 'processing':
      return 'Processing';
    case 'pending':
      return 'Pending';
    default:
      return status;
  }
}

/** Shared success / receipt card used by all three transfer flows. */
export default function TransferReceipt({ receipt, onDone }: Props) {
  const pending = PENDING_STATUSES.has(receipt.status);
  const date = new Date(receipt.createdAt).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const onShare = () => {
    void Share.share({
      message:
        `Paymax transfer receipt\n` +
        `Amount: ${formatNaira(receipt.amountKobo)}\n` +
        `To: ${receipt.destinationName}${receipt.destinationDetail ? ` (${receipt.destinationDetail})` : ''}\n` +
        `Reference: ${receipt.reference}\n` +
        `Status: ${statusLabel(receipt.status)}\n` +
        `Date: ${date}`,
    });
  };

  return (
    <View>
      <View style={[styles.card, shadow1]}>
        <View style={styles.iconWrap}>
          {pending ? (
            <Clock size={44} color={Colors.gold} strokeWidth={1.8} />
          ) : (
            <CheckCircle size={44} color={Colors.teal} strokeWidth={1.8} />
          )}
        </View>
        <Text style={styles.title}>{pending ? 'Transfer Initiated' : 'Transfer Successful'}</Text>
        <Text style={styles.amount}>{formatNaira(receipt.amountKobo)}</Text>
        <Text style={styles.sub}>to {receipt.destinationName}</Text>

        <View style={styles.divider} />

        <Row k="Status" v={statusLabel(receipt.status)} accent={!pending} />
        <Row k="From" v={receipt.sourceLabel} />
        <Row k="To" v={receipt.destinationName} />
        {receipt.destinationDetail ? <Row k="Destination" v={receipt.destinationDetail} /> : null}
        <Row k="Amount" v={formatNaira(receipt.amountKobo)} />
        <Row k="Fee" v={receipt.feeKobo === 0 ? 'Free' : formatNaira(receipt.feeKobo)} />
        <Row k="Total" v={formatNaira(receipt.totalKobo)} strong />
        {receipt.provider ? <Row k="Provider" v={receipt.provider} /> : null}
        <Row k="Reference" v={receipt.reference} mono />
        <Row k="Date" v={date} />

        {pending ? (
          <View style={styles.note}>
            <Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.noteText}>
              Funds usually arrive within minutes. You'll get a confirmation once the transfer settles.
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable onPress={onShare} style={styles.shareRow} accessibilityRole="button">
        <Share2 size={16} color={Colors.primary} strokeWidth={2.2} />
        <Text style={styles.shareText}>Share receipt</Text>
      </Pressable>

      <PrimaryButton label="Done" onPress={onDone} />
    </View>
  );
}

function Row({ k, v, strong, mono, accent }: { k: string; v: string; strong?: boolean; mono?: boolean; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text
        style={[styles.rowVal, strong && styles.rowValStrong, mono && styles.rowValMono, accent && styles.rowValAccent]}
        numberOfLines={1}
      >
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.md,
  },
  iconWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  title: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  amount: { ...Typography.headlineMd, color: Colors.primary, textAlign: 'center', marginTop: Spacing.xs },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: Spacing.md },
  rowKey: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  rowValStrong: { ...Typography.titleMd, color: Colors.primary },
  rowValMono: { ...Typography.labelSm, fontFamily: 'monospace', color: Colors.onSurfaceVariant },
  rowValAccent: { color: Colors.teal },
  note: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginTop: Spacing.md,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  shareText: { ...Typography.labelMd, color: Colors.primary },
});
