// ── Paymax · Admin Console — KYC case detail ─────────────────────────────────
// Case detail (tier, risk flags, timestamps). If the role holds `kyc.review`,
// surfaces Approve / Reject actions gated behind a required reason. On success
// the backend may return a maker-checker pending state — we surface the result.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { AdminHeader, ListCard, DataRow, StatusPill, ReasonPrompt } from '@/features/admin/components';
import { useKycQueue, useReviewKyc } from '@/features/admin/hooks/useAdmin';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import {
  KYC_STATUS_STYLE,
  can,
  formatDateTime,
} from '@/features/admin/constants/admin.constants';
import type { KycDecision, Permission } from '@/features/admin/types/admin.types';

const PERM_KYC_REVIEW: Permission = 'kyc.review';

export default function AdminKycDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useKycQueue();
  const review = useReviewKyc();
  const { role } = useAdminRole();

  // The link from a user profile passes the userId; the queue uses case id.
  const kase = useMemo(
    () => (queue.data ?? []).find((c) => c.id === id || c.userId === id),
    [queue.data, id],
  );

  const [pending, setPending] = useState<KycDecision | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<string | null>(null);

  const allowed = can(role, PERM_KYC_REVIEW);
  const actionable = kase?.status === 'pending' || kase?.status === 'escalated';

  const submit = () => {
    if (!kase || !pending) return;
    if (pending !== 'approve' && reason.trim().length < 3) {
      setReasonError('A reason is required for the audit log.');
      return;
    }
    setReasonError(undefined);
    review.mutate(
      { id: kase.id, decision: pending, reason: reason.trim() },
      {
        onSuccess: (updated) => {
          const label = KYC_STATUS_STYLE[updated.status]?.label ?? updated.status;
          setResult(`Submitted. Case is now "${label}". A maker-checker approval may be required before it takes effect.`);
          setPending(null);
          setReason('');
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="KYC case" subtitle={kase?.name} />

      {queue.isLoading ? (
        <StateView kind="loading" message="Loading case…" />
      ) : queue.isError ? (
        <StateView
          kind="error"
          title="Couldn't load the case"
          message="Please check your connection and try again."
          actionLabel="Retry"
          onAction={() => queue.refetch()}
        />
      ) : !kase ? (
        <StateView kind="empty" icon="FileQuestion" title="Case not found" message="This KYC case is no longer in the queue." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Header summary */}
          <View style={styles.hero}>
            <Text style={styles.heroName}>{kase.name}</Text>
            <Text style={styles.heroMeta}>Requesting Tier {kase.tier}</Text>
            <View style={styles.heroPills}>
              <StatusPill status={kase.status} styleMap={KYC_STATUS_STYLE} />
            </View>
          </View>

          <ListCard title="Case" flush>
            <DataRow label="Case ID" value={kase.id} />
            <DataRow label="User ID" value={kase.userId} />
            <DataRow label="Requested tier" value={`Tier ${kase.tier}`} />
            <DataRow label="Submitted" value={formatDateTime(kase.submittedAt)} last />
          </ListCard>

          <ListCard title="Risk flags" flush>
            {kase.riskFlags.length === 0 ? (
              <DataRow label="No risk flags" value="Clear" last />
            ) : (
              kase.riskFlags.map((f, i, arr) => (
                <DataRow
                  key={f}
                  label={f}
                  right={<StatusPill chip={{ label: 'Flag', fg: Colors.onWarning, bg: Colors.iconBgGold }} />}
                  last={i === arr.length - 1}
                />
              ))
            )}
          </ListCard>

          {/* Decision result confirmation */}
          {result ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultText}>{result}</Text>
            </View>
          ) : null}

          {review.isError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{(review.error as Error)?.message ?? 'Could not submit the review.'}</Text>
            </View>
          ) : null}

          {/* Privileged actions — hidden entirely if the role lacks permission */}
          {!allowed ? (
            <View style={styles.restricted}>
              <Text style={styles.restrictedText}>
                Your role can view this case but cannot approve or reject KYC.
              </Text>
            </View>
          ) : !actionable ? (
            <View style={styles.restricted}>
              <Text style={styles.restrictedText}>This case has already been decided.</Text>
            </View>
          ) : (
            <View style={styles.actions}>
              {pending ? (
                <View style={styles.reasonBlock}>
                  <ReasonPrompt
                    value={reason}
                    onChangeText={(t) => { setReason(t); if (reasonError) setReasonError(undefined); }}
                    label={pending === 'approve' ? 'Note (optional)' : 'Reason'}
                    placeholder={pending === 'approve' ? 'Add an optional note…' : 'Why is this being rejected?'}
                    error={reasonError}
                  />
                  <View style={styles.confirmRow}>
                    <View style={styles.flex}>
                      <PrimaryButton label="Cancel" variant="ghost" onPress={() => { setPending(null); setReason(''); setReasonError(undefined); }} />
                    </View>
                    <View style={styles.flex}>
                      <PrimaryButton
                        label={pending === 'approve' ? 'Confirm approve' : 'Confirm reject'}
                        variant={pending === 'approve' ? 'primary' : 'danger'}
                        loading={review.isPending}
                        onPress={submit}
                      />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.confirmRow}>
                  <View style={styles.flex}>
                    <PrimaryButton label="Reject" variant="danger" onPress={() => { setPending('reject'); setResult(null); }} />
                  </View>
                  <View style={styles.flex}>
                    <PrimaryButton label="Approve" onPress={() => { setPending('approve'); setResult(null); }} />
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, gap: Spacing.md },
  flex: { flex: 1 },
  hero: {
    marginHorizontal: Spacing.containerMargin,
    marginTop: Spacing.xs,
    padding: Spacing.cardPadding,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    gap: Spacing.xs,
  },
  heroName: { ...Typography.titleLg, color: Colors.onSurface },
  heroMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  heroPills: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  actions: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.xs },
  reasonBlock: { gap: Spacing.sm },
  confirmRow: { flexDirection: 'row', gap: Spacing.sm },
  resultCard: {
    marginHorizontal: Spacing.containerMargin,
    padding: Spacing.md,
    backgroundColor: Colors.iconBgGreen,
    borderRadius: Radius.lg,
  },
  resultText: { ...Typography.bodySm, color: Colors.onSurface },
  errorCard: {
    marginHorizontal: Spacing.containerMargin,
    padding: Spacing.md,
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.lg,
  },
  errorText: { ...Typography.bodySm, color: Colors.error },
  restricted: {
    marginHorizontal: Spacing.containerMargin,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
  },
  restrictedText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
