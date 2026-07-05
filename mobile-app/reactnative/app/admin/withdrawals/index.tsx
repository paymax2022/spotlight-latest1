// ── Paymax · Admin Console — Withdrawal review queue ─────────────────────────
// Withdrawals awaiting approval. KPI row (pending count + total value), then the
// queue as WithdrawalReviewRow items. Tapping a pending row opens an inline
// Approve / Reject panel (reject requires a reason) gated by `withdrawal.approve`.
// The decision may land in a maker-checker pending state (surfaced from the
// response). Read-only for roles without the permission.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { AdminHeader, KpiCard, WithdrawalReviewRow, ListCard, ReasonPrompt } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useWithdrawalQueue, useReviewWithdrawal } from '@/features/admin/hooks/useAdmin';
import {
  WITHDRAWAL_STATUS_STYLE,
  can,
  formatMoneyObj,
  formatMoneyCompact,
} from '@/features/admin/constants/admin.constants';
import type { WithdrawalDecision, WithdrawalReviewItem } from '@/features/admin/types/admin.types';

export default function AdminWithdrawalsScreen() {
  const { role } = useAdminRole();
  const allowed = can(role, 'withdrawal.approve');

  const queue = useWithdrawalQueue();
  const review = useReviewWithdrawal();

  const [openRef, setOpenRef] = useState<string | null>(null);
  const [pending, setPending] = useState<WithdrawalDecision | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const list = queue.data ?? [];

  const kpis = useMemo(() => {
    const pendingItems = list.filter((w) => w.status === 'pending');
    // Sum only same-currency in-asset values defensively; surface count + the
    // dominant-symbol total if the queue is single-asset, else raw count of value.
    const totalBySymbol = pendingItems.reduce<Record<string, number>>((acc, w) => {
      acc[w.amount.currency] = (acc[w.amount.currency] ?? 0) + w.amount.amount;
      return acc;
    }, {});
    const symbols = Object.keys(totalBySymbol);
    const totalLabel =
      symbols.length === 1
        ? formatMoneyCompact(totalBySymbol[symbols[0]], symbols[0])
        : `${symbols.length} assets`;
    return { count: pendingItems.length, totalLabel };
  }, [list]);

  const openPanel = (item: WithdrawalReviewItem) => {
    if (item.status !== 'pending' || !allowed) return;
    setOpenRef((prev) => (prev === item.reference ? null : item.reference));
    setPending(null);
    setReason('');
    setError(undefined);
    setNotice(undefined);
  };

  const submit = (item: WithdrawalReviewItem) => {
    if (!pending) return;
    setError(undefined);
    if (pending !== 'approve' && reason.trim().length < 3) {
      setError('A reason is required for the audit log.');
      return;
    }
    review.mutate(
      { ref: item.reference, decision: pending, reason: reason.trim() },
      {
        onSuccess: (updated) => {
          const label = WITHDRAWAL_STATUS_STYLE[updated.status]?.label ?? updated.status;
          setNotice(
            `Submitted. ${item.reference} is now "${label}". A maker-checker approval may be required before funds move.`,
          );
          setOpenRef(null);
          setPending(null);
          setReason('');
        },
        onError: (e) => setError((e as Error)?.message ?? 'Could not submit the review.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Withdrawals" subtitle="Approve & review" />

      {queue.isLoading ? (
        <StateView kind="loading" message="Loading withdrawals…" />
      ) : queue.isError ? (
        <StateView
          kind="error"
          title="Couldn't load withdrawals"
          message={(queue.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => queue.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Banknote" title="Queue is clear" message="No withdrawals are waiting for review." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={queue.isRefetching} onRefresh={() => queue.refetch()} tintColor={Colors.primary} />
          }
        >
          <View style={styles.kpiRow}>
            <KpiCard label="Pending" value={String(kpis.count)} icon="Clock" intent="warning" iconBg={Colors.iconBgGold} iconColor={Colors.onWarning} />
            <KpiCard label="Pending value" value={kpis.totalLabel} icon="Banknote" iconBg={Colors.iconBgPurple} iconColor={Colors.primary} />
          </View>

          {!allowed ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Read-only — your role can view the queue but can't approve withdrawals.</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={[styles.banner, styles.noticeBanner]}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <ListCard flush>
            {list.map((item, i, arr) => {
              const last = i === arr.length - 1;
              const open = openRef === item.reference;
              return (
                <View key={item.reference}>
                  <WithdrawalReviewRow
                    item={item}
                    onPress={() => openPanel(item)}
                    last={last && !open}
                  />
                  {open ? (
                    <View style={[styles.panel, !last && styles.panelBorder]}>
                      <View style={styles.panelMeta}>
                        <Text style={styles.panelMetaText}>Amount: {formatMoneyObj(item.amount)}</Text>
                        <Text style={styles.panelMetaText}>Risk score: {item.riskScore}/100</Text>
                      </View>
                      {pending ? (
                        <>
                          <ReasonPrompt
                            value={reason}
                            onChangeText={(t) => { setReason(t); if (error) setError(undefined); }}
                            label={pending === 'approve' ? 'Note (optional)' : 'Reason'}
                            placeholder={pending === 'approve' ? 'Add an optional note…' : 'Why is this being rejected?'}
                            error={error}
                          />
                          <Text style={styles.makerNote}>
                            High-value approvals route through maker-checker before funds are released.
                          </Text>
                          <View style={styles.actions}>
                            <View style={styles.actionBtn}>
                              <PrimaryButton label="Cancel" variant="secondary" onPress={() => { setPending(null); setReason(''); setError(undefined); }} disabled={review.isPending} />
                            </View>
                            <View style={styles.actionBtn}>
                              <PrimaryButton
                                label={pending === 'approve' ? 'Confirm approve' : 'Confirm reject'}
                                variant={pending === 'approve' ? 'primary' : 'danger'}
                                loading={review.isPending}
                                onPress={() => submit(item)}
                              />
                            </View>
                          </View>
                        </>
                      ) : (
                        <View style={styles.actions}>
                          <View style={styles.actionBtn}>
                            <PrimaryButton label="Reject" variant="danger" onPress={() => { setPending('reject'); setNotice(undefined); }} />
                          </View>
                          <View style={styles.actionBtn}>
                            <PrimaryButton label="Approve" onPress={() => { setPending('approve'); setNotice(undefined); }} />
                          </View>
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ListCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm, gap: Spacing.md },
  kpiRow: { flexDirection: 'row', gap: Spacing.md, marginHorizontal: Spacing.containerMargin },
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
  panel: { paddingHorizontal: Spacing.cardPadding, paddingBottom: Spacing.md, gap: Spacing.sm },
  panelBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  panelMeta: { gap: 2 },
  panelMetaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  makerNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1 },
});
