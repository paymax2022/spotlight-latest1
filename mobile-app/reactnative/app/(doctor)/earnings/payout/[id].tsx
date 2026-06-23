import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { AlertTriangle, X, Scale } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { formatKobo } from '@/api/doctor.batch6.api';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, AlertCard } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePayoutDetail, useSettlementDisputes, useRaiseSettlementDispute } from '@/features/doctor/hooks';
import {
  PAYOUT_DETAIL_STATUS_LABELS,
  SETTLEMENT_DISPUTE_STATUS_LABELS,
} from '@/features/doctor/constants';
import type { PayoutDetailStatus } from '@/types/doctor.batch6';

const STATUS_TONE: Record<PayoutDetailStatus, StatusTone> = {
  pending:    'warning',
  processing: 'info',
  paid:       'success',
  failed:     'danger',
};

export default function PayoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: payout, isLoading, isError, refetch } = usePayoutDetail(String(id));
  const { data: disputes = [] } = useSettlementDisputes();
  const raiseDispute = useRaiseSettlementDispute();

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');

  const existing = disputes.find((d) => d.payoutId === String(id));

  const submitDispute = async () => {
    if (!payout) return;
    if (!reason.trim()) { Alert.alert('Reason required', 'Describe the settlement issue.'); return; }
    try {
      const res = await raiseDispute.mutateAsync({ payoutId: payout.id, amountKobo: payout.amountKobo, reason: reason.trim() });
      setDisputeOpen(false); setReason('');
      Alert.alert('Dispute raised', `Dispute ${res.ref} is ${res.status}.`);
    } catch {
      Alert.alert('Failed', 'Please try again in a moment.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Payout Detail" />

      {isLoading && !payout ? (
        <StateView variant="loading" label="Loading payout" />
      ) : isError || !payout ? (
        <StateView variant="error" message="We could not load this payout." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <View style={styles.headerBody}>
              <Text style={styles.ref}>{payout.ref}</Text>
              <Text style={styles.period}>{payout.periodLabel}</Text>
            </View>
            <StatusBadge label={PAYOUT_DETAIL_STATUS_LABELS[payout.status]} tone={STATUS_TONE[payout.status]} />
          </View>

          {/* Failed payout — visibly surfaced */}
          {payout.status === 'failed' && (
            <AlertCard
              icon={AlertTriangle}
              tone="critical"
              title="Payout failed"
              body={payout.failureReason ?? 'This payout could not be completed.'}
              ctaLabel={existing ? undefined : 'Raise a settlement dispute'}
              onPress={existing ? undefined : () => setDisputeOpen(true)}
            />
          )}

          <SectionCard title="Amount" style={styles.card}>
            <InfoRow label="Gross" value={formatKobo(payout.amountKobo)} />
            <InfoRow label="Processing fee" value={`- ${formatKobo(payout.feeKobo)}`} valueColor={Colors.error} />
            <InfoRow label="Net paid" value={formatKobo(payout.netKobo)} valueColor={Colors.teal} />
            <InfoRow label="Consults" value={String(payout.consultCount)} />
          </SectionCard>

          <SectionCard title="Destination" style={styles.card}>
            <InfoRow label="Bank" value={payout.bankAccount.bankName} />
            <InfoRow label="Account" value={`••••${payout.bankAccount.accountNumber.slice(-4)}`} />
            <InfoRow label="Name" value={payout.bankAccount.accountName} />
          </SectionCard>

          <SectionCard title="Timeline" style={styles.card}>
            <InfoRow label="Requested" value={new Date(payout.requestedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />
            {!!payout.paidAt && <InfoRow label="Paid" value={new Date(payout.paidAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />}
            {!!payout.sessionId && <InfoRow label="Settlement ref" value={payout.sessionId} />}
          </SectionCard>

          {/* Existing dispute */}
          {existing && (
            <SectionCard title="Settlement dispute" style={styles.card}>
              <View style={styles.disputeHead}>
                <Text style={styles.disputeRef}>{existing.ref}</Text>
                <StatusBadge label={SETTLEMENT_DISPUTE_STATUS_LABELS[existing.status]} tone="info" />
              </View>
              <Text style={styles.disputeBody}>{existing.reason}</Text>
            </SectionCard>
          )}

          {/* Allow disputing non-failed too */}
          {!existing && payout.status !== 'failed' && (
            <Pressable style={styles.disputeLink} onPress={() => setDisputeOpen(true)} accessibilityRole="button" accessibilityLabel="Raise a settlement dispute">
              <Scale size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.disputeLinkText}>Raise a settlement dispute</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* Dispute sheet */}
      <Modal visible={disputeOpen} transparent animationType="slide" onRequestClose={() => setDisputeOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDisputeOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <Scale size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.sheetTitle}>Settlement dispute</Text>
            </View>
            <Pressable onPress={() => setDisputeOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close dispute sheet">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={styles.sheetMeta}>Disputing {formatKobo(payout?.amountKobo ?? 0)} · {payout?.ref}</Text>
          <TextInputField label="Reason" placeholder="Describe the settlement issue" value={reason} onChangeText={setReason} multiline />
          <PrimaryButton label="Submit dispute" onPress={submitDispute} loading={raiseDispute.isPending} style={styles.sheetBtn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md },
  headerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  headerBody:  { flex: 1, gap: 2 },
  ref:         { ...Typography.headlineMd, color: Colors.onSurface },
  period:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:        { marginBottom: 0 },
  disputeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.xs },
  disputeRef:  { ...Typography.labelLg, color: Colors.onSurface },
  disputeBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  disputeLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'flex-start' },
  disputeLinkText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '600' },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, gap: Spacing.sm },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  sheetMeta:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sheetBtn:    { marginTop: Spacing.sm },
});
