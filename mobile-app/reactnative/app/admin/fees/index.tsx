// ── Paymax · Admin Console — Fee config ──────────────────────────────────────
// Pricing config. Each fee shows label/kind/bps. With `fee.config` the bps value
// is editable inline behind a required reason; the change may route through
// maker-checker before it goes live (noted in the editor). Read-only otherwise.

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { AdminHeader, ListCard, DataRow, ReasonPrompt } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useFees, useUpdateFee } from '@/features/admin/hooks/useAdmin';
import { can, formatBps } from '@/features/admin/constants/admin.constants';
import type { FeeConfigItem } from '@/features/admin/types/admin.types';

function feeKindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

export default function AdminFeesScreen() {
  const { role } = useAdminRole();
  const allowed = can(role, 'fee.config');

  const fees = useFees();
  const update = useUpdateFee();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [bps, setBps] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const list = fees.data ?? [];

  const beginEdit = (fee: FeeConfigItem) => {
    setEditingId(fee.id);
    setBps(String(fee.bps));
    setReason('');
    setError(undefined);
    setNotice(undefined);
  };

  const cancel = () => {
    setEditingId(null);
    setBps('');
    setReason('');
    setError(undefined);
  };

  const submit = (fee: FeeConfigItem) => {
    setError(undefined);
    const next = Number(bps.replace(/,/g, ''));
    if (!Number.isInteger(next) || next < 0 || next > 10_000) {
      setError('Enter basis points between 0 and 10000.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required for the audit log.');
      return;
    }
    update.mutate(
      { id: fee.id, bps: next },
      {
        onSuccess: () => {
          setNotice(`Updated ${fee.label}. Pricing changes may require maker-checker approval before they take effect.`);
          cancel();
        },
        onError: (e) => setError((e as Error)?.message ?? 'Update failed. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Fees" subtitle="Pricing config" />

      {fees.isLoading ? (
        <StateView kind="loading" message="Loading fees…" />
      ) : fees.isError ? (
        <StateView
          kind="error"
          title="Couldn't load fees"
          message={(fees.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => fees.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Percent" title="No fees configured" message="Fee configuration will appear here." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={fees.isRefetching} onRefresh={() => fees.refetch()} tintColor={Colors.primary} />
          }
        >
          {!allowed ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Read-only — your role can't change fees.</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={[styles.banner, styles.noticeBanner]}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <ListCard flush>
            {list.map((fee, i, arr) => {
              const editing = editingId === fee.id;
              const last = i === arr.length - 1;
              if (editing) {
                return (
                  <View key={fee.id} style={[styles.editor, !last && styles.editorBorder]}>
                    <Text style={styles.editorLabel}>{fee.label}</Text>
                    <Text style={styles.editorKind}>{feeKindLabel(fee.kind)}</Text>
                    <TextInputField
                      label="Fee (basis points)"
                      value={bps}
                      onChangeText={(t) => { setBps(t); if (error) setError(undefined); }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                    <Text style={styles.preview}>= {formatBps(Number(bps.replace(/,/g, '')) || 0)}</Text>
                    <ReasonPrompt value={reason} onChangeText={setReason} error={error} />
                    <Text style={styles.makerNote}>
                      Pricing changes route through maker-checker before they go live.
                    </Text>
                    <View style={styles.actions}>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Cancel" variant="secondary" onPress={cancel} disabled={update.isPending} />
                      </View>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Save" onPress={() => submit(fee)} loading={update.isPending} />
                      </View>
                    </View>
                  </View>
                );
              }
              return (
                <DataRow
                  key={fee.id}
                  label={fee.label}
                  sublabel={feeKindLabel(fee.kind)}
                  value={`${formatBps(fee.bps)} · ${fee.bps} bps`}
                  onPress={allowed ? () => beginEdit(fee) : undefined}
                  showChevron={allowed}
                  last={last}
                />
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
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  banner: {
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.md,
  },
  bannerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  noticeBanner: { backgroundColor: Colors.iconBgTeal },
  noticeText: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  editor: { paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.md, gap: 2 },
  editorBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  editorLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  editorKind: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  preview: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -Spacing.xs, marginBottom: Spacing.xs },
  makerNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: { flex: 1 },
});
