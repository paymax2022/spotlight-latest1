// ── Paymax · Admin Console — Maker-checker approvals ─────────────────────────
// The maker-checker queue. Each item is an ApprovalCard. A pending item is
// actionable only when the role holds `approval.act` AND the current role isn't
// the maker (the checker must differ — also enforced server-side). Reject opens
// an inline ReasonPrompt. Filter by status via a SegmentedControl.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import { AdminHeader, ApprovalCard, ReasonPrompt } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useApprovals, useApprove, useRejectApproval } from '@/features/admin/hooks/useAdmin';
import { can } from '@/features/admin/constants/admin.constants';
import type { ApprovalStatus } from '@/features/admin/types/admin.types';

type Filter = 'pending' | 'approved' | 'rejected';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function AdminApprovalsScreen() {
  const { role } = useAdminRole();
  const allowed = can(role, 'approval.act');

  const approvals = useApprovals();
  const approve = useApprove();
  const reject = useRejectApproval();

  const [filter, setFilter] = useState<Filter>('pending');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const list = useMemo(
    () => (approvals.data ?? []).filter((a) => a.status === (filter as ApprovalStatus)),
    [approvals.data, filter],
  );

  const onApprove = (id: string) => {
    setError(undefined);
    setNotice(undefined);
    approve.mutate(id, {
      onSuccess: () => setNotice('Approved. The change has cleared maker-checker and will take effect.'),
      onError: (e) => setError((e as Error)?.message ?? 'Could not approve. Please try again.'),
    });
  };

  const beginReject = (id: string) => {
    setRejectingId(id);
    setReason('');
    setError(undefined);
    setNotice(undefined);
  };

  const submitReject = (id: string) => {
    setError(undefined);
    if (reason.trim().length < 3) {
      setError('A reason is required for the audit log.');
      return;
    }
    reject.mutate(
      { id, reason: reason.trim() },
      {
        onSuccess: () => {
          setNotice('Rejected. The maker has been notified and the change will not take effect.');
          setRejectingId(null);
          setReason('');
        },
        onError: (e) => setError((e as Error)?.message ?? 'Could not reject. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Approvals" subtitle="Maker-checker queue" />

      <View style={styles.filterWrap}>
        <SegmentedControl<Filter> options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {approvals.isLoading ? (
        <StateView kind="loading" message="Loading approvals…" />
      ) : approvals.isError ? (
        <StateView
          kind="error"
          title="Couldn't load approvals"
          message={(approvals.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => approvals.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView
          kind="empty"
          icon="CheckCheck"
          title={`No ${filter} approvals`}
          message={filter === 'pending' ? 'Nothing is waiting for a checker right now.' : `No ${filter} items in the queue.`}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={approvals.isRefetching} onRefresh={() => approvals.refetch()} tintColor={Colors.primary} />
          }
        >
          {!allowed ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Read-only — your role can view the queue but can't act on approvals.</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={[styles.banner, styles.noticeBanner]}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          {list.map((approval) => {
            // Checker must differ from the maker (also enforced server-side).
            const isMaker = approval.maker === role;
            const canAct = allowed && approval.status === 'pending' && !isMaker;
            const isRejecting = rejectingId === approval.id;
            return (
              <View key={approval.id} style={styles.cardWrap}>
                <ApprovalCard
                  approval={approval}
                  canAct={canAct && !isRejecting}
                  onApprove={() => onApprove(approval.id)}
                  onReject={() => beginReject(approval.id)}
                  approving={approve.isPending}
                  rejecting={reject.isPending}
                />
                {allowed && approval.status === 'pending' && isMaker ? (
                  <Text style={styles.makerNote}>
                    You proposed this change — a different admin must check it.
                  </Text>
                ) : null}
                {isRejecting ? (
                  <View style={styles.rejectPanel}>
                    <ReasonPrompt
                      value={reason}
                      onChangeText={(t) => { setReason(t); if (error) setError(undefined); }}
                      placeholder="Why is this change being rejected?"
                      error={error}
                    />
                    <View style={styles.actions}>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Cancel" variant="secondary" onPress={() => { setRejectingId(null); setReason(''); setError(undefined); }} disabled={reject.isPending} />
                      </View>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Confirm reject" variant="danger" loading={reject.isPending} onPress={() => submitReject(approval.id)} />
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { marginVertical: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl, gap: Spacing.md },
  banner: {
    marginHorizontal: Spacing.containerMargin,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.md,
  },
  bannerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  noticeBanner: { backgroundColor: Colors.iconBgTeal },
  noticeText: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  cardWrap: { gap: Spacing.sm },
  makerNote: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginHorizontal: Spacing.containerMargin,
  },
  rejectPanel: {
    marginHorizontal: Spacing.containerMargin,
    gap: Spacing.sm,
  },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1 },
});
