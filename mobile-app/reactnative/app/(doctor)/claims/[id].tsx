import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { formatKobo } from '@/api/doctor.phase2.api';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge, StatusTimeline, SoapSection } from '@/features/doctor/components';
import type { StatusTone, TimelineStep } from '@/features/doctor/components';
import { useHmoClaim, useDisputeClaim } from '@/features/doctor/hooks';
import { CLAIM_STATUS_LABELS } from '@/features/doctor/constants';
import type { ClaimStatus } from '@/types/doctor.phase2';

const STATUS_TONE: Record<ClaimStatus, StatusTone> = {
  submitted:    'neutral',
  under_review: 'info',
  approved:     'brand',
  rejected:     'danger',
  disputed:     'warning',
  paid:         'success',
};

const DISPUTABLE: ClaimStatus[] = ['rejected', 'approved', 'under_review'];

export default function ClaimDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const claimId = String(id);
  const { data: claim, isLoading, isError, refetch } = useHmoClaim(claimId);
  const dispute = useDisputeClaim();

  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState('');

  const handleDispute = async () => {
    if (reason.trim().length === 0) {
      Alert.alert('Add a reason', 'Explain why you are disputing this claim.');
      return;
    }
    try {
      await dispute.mutateAsync({ claimId, reason: reason.trim() });
      Alert.alert('Dispute submitted', 'The HMO will review your dispute.');
      setShowDispute(false);
      setReason('');
    } catch {
      Alert.alert('Failed', 'Please try again.');
    }
  };

  const steps: TimelineStep[] = (claim?.timeline ?? []).map((e, i, arr) => ({
    label:     e.label || CLAIM_STATUS_LABELS[e.status],
    at:        new Date(e.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
    note:      e.note,
    completed: i < arr.length - 1,
    current:   i === arr.length - 1,
  }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Claim Detail" />

      {isLoading && !claim ? (
        <StateView variant="loading" label="Loading claim" />
      ) : isError || !claim ? (
        <StateView variant="error" message="We could not load this claim." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <DoctorAvatar initials={claim.patient.initials} color={claim.patient.avatarColor} size={56} />
              <View style={styles.headerBody}>
                <Text style={styles.patient} numberOfLines={1}>{claim.patient.name}</Text>
                <Text style={styles.ref}>{claim.ref} · {claim.provider}</Text>
              </View>
              <StatusBadge label={CLAIM_STATUS_LABELS[claim.status]} tone={STATUS_TONE[claim.status]} />
            </View>

            <SectionCard title="Summary" style={styles.card}>
              <InfoRow label="Claimed" value={formatKobo(claim.claimedKobo)} />
              <InfoRow label="Approved" value={formatKobo(claim.approvedKobo)} valueColor={claim.approvedKobo > 0 ? Colors.teal : Colors.onSurface} />
              {!!claim.authCode && <InfoRow label="Auth code" value={claim.authCode} valueColor={Colors.secondary} />}
              <InfoRow label="Submitted" value={new Date(claim.submittedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
              {!!claim.decidedAt && <InfoRow label="Decided" value={new Date(claim.decidedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />}
            </SectionCard>

            <SectionCard title="Line items" style={styles.card}>
              {claim.lineItems.map((item, i) => (
                <View key={`${item.description}-${i}`} style={[styles.lineRow, i > 0 && styles.rowBorder]}>
                  <View style={styles.lineBody}>
                    <Text style={styles.lineDesc}>{item.description}</Text>
                    <View style={styles.coverTag}>
                      {item.covered
                        ? <Check size={12} color={Colors.teal} strokeWidth={2.5} />
                        : <X size={12} color={Colors.error} strokeWidth={2.5} />}
                      <Text style={[styles.coverText, { color: item.covered ? Colors.teal : Colors.error }]}>{item.covered ? 'Covered' : 'Not covered'}</Text>
                    </View>
                  </View>
                  <Text style={styles.lineAmount}>{formatKobo(item.amountKobo)}</Text>
                </View>
              ))}
            </SectionCard>

            {claim.status === 'rejected' && !!claim.rejectionReason && (
              <SectionCard title="Rejection reason" style={styles.card}>
                <Text style={styles.rejection}>{claim.rejectionReason}</Text>
              </SectionCard>
            )}

            <SectionCard title="Timeline" style={styles.card}>
              <StatusTimeline steps={steps} />
            </SectionCard>

            {DISPUTABLE.includes(claim.status) && (
              showDispute ? (
                <SectionCard title="Dispute claim" style={styles.card}>
                  <SoapSection label="Reason" hint="Explain the basis for your dispute" value={reason} onChangeText={setReason} placeholder="e.g. Teleconsultation is covered under the patient's plan" />
                  <View style={styles.actions}>
                    <PrimaryButton label="Submit dispute" onPress={handleDispute} loading={dispute.isPending} style={styles.btn} />
                    <PrimaryButton label="Cancel" onPress={() => { setShowDispute(false); setReason(''); }} variant="secondary" disabled={dispute.isPending} style={styles.btn} />
                  </View>
                </SectionCard>
              ) : (
                <PrimaryButton label="Dispute claim" onPress={() => setShowDispute(true)} variant="secondary" style={styles.card} />
              )
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  flex:       { flex: 1 },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  header:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  headerBody: { flex: 1, gap: 2 },
  patient:    { ...Typography.titleLg, color: Colors.onSurface },
  ref:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:       { marginBottom: Spacing.md },
  lineRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  lineBody:   { flex: 1, gap: 4 },
  lineDesc:   { ...Typography.labelMd, color: Colors.onSurface },
  coverTag:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coverText:  { ...Typography.caption, fontWeight: '600' },
  lineAmount: { ...Typography.labelLg, color: Colors.onSurface },
  rejection:  { ...Typography.bodyMd, color: Colors.error },
  actions:    { gap: Spacing.sm, marginTop: Spacing.sm },
  btn:        {},
});
