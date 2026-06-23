import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { VotingColors, VOTE_STATUS_LABELS } from '../constants/voting.constants';
import { formatAmount, formatDate } from '../utils/voteFormatters';
import type { VoteTransaction } from '../types/voting.types';

interface Props {
  transaction: VoteTransaction;
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowValueHighlight]}>{value}</Text>
    </View>
  );
}

export default function VoteReceiptCard({ transaction: tx }: Props) {
  const statusColor = tx.status === 'SUCCESSFUL'
    ? VotingColors.contestLive
    : tx.status === 'FAILED'
    ? Colors.error
    : Colors.onSurfaceVariant;

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Receipt size={22} color={Colors.primary} strokeWidth={1.5} />
        </View>
        <View>
          <Text style={styles.title}>Vote Receipt</Text>
          <Text style={styles.ref}>{tx.reference}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Row label="Contest"    value={tx.contestTitle ?? '—'} />
      <Row label="Contestant" value={tx.contestantName ?? '—'} />
      <Row label="Vote Type"  value={tx.voteType === 'FREE' ? 'Free Votes' : 'Paid Votes'} />
      <Row label="Votes Cast" value={`${tx.votes} votes`} highlight />
      {tx.amount != null && <Row label="Amount Paid" value={formatAmount(tx.amount)} highlight />}

      <View style={styles.divider} />

      <Row label="Status" value={VOTE_STATUS_LABELS[tx.status] ?? tx.status} />
      <Row label="Date"   value={formatDate(tx.createdAt)} />

      <View style={[styles.statusBadge, { backgroundColor: statusColor + '18', borderColor: statusColor + '44' }]}>
        <Text style={[styles.statusText, { color: statusColor }]}>
          {VOTE_STATUS_LABELS[tx.status] ?? tx.status}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.xl,
    padding:         Spacing.lg,
    borderWidth:     1,
    borderColor:     Colors.surfaceContainerHigh,
    gap:             Spacing.sm,
  },
  header:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xs },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title:    { ...Typography.titleMd, color: Colors.onSurface },
  ref:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider:  { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 4 },
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface },
  rowValueHighlight: { color: Colors.primary, fontWeight: '700' as const },
  statusBadge: {
    alignSelf:        'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.sm,
    borderRadius:      Radius.full,
    borderWidth:       1,
    marginTop:         Spacing.xs,
  },
  statusText: { ...Typography.labelMd, fontWeight: '700' as const },
});
