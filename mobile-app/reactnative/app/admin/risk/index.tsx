// ── Paymax · Admin Console — Risk limits ─────────────────────────────────────
// Exposure controls. Each limit shows label/scope/value. With `risk.config` the
// value is editable inline (major units → minor) behind a required reason; the
// change may land in a maker-checker pending state (surfaced from the response).
// Read-only otherwise.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { AdminHeader, ListCard, DataRow, ReasonPrompt } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useRiskLimits, useUpdateRiskLimit } from '@/features/admin/hooks/useAdmin';
import { can, formatMoney } from '@/features/admin/constants/admin.constants';
import type { RiskLimit } from '@/features/admin/types/admin.types';

/** Decimals used to convert the human major-unit input back to minor units. */
const FIAT_DECIMALS: Record<string, number> = { NGN: 2, USD: 2 };
const decimalsFor = (currency: string) => FIAT_DECIMALS[currency] ?? 8;

export default function AdminRiskScreen() {
  const { role } = useAdminRole();
  const allowed = can(role, 'risk.config');

  const limits = useRiskLimits();
  const update = useUpdateRiskLimit();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const list = limits.data ?? [];

  const beginEdit = (limit: RiskLimit) => {
    setEditingId(limit.id);
    setValue(String(limit.valueMinor / 10 ** decimalsFor(limit.currency)));
    setReason('');
    setError(undefined);
    setNotice(undefined);
  };

  const cancel = () => {
    setEditingId(null);
    setValue('');
    setReason('');
    setError(undefined);
  };

  const submit = (limit: RiskLimit) => {
    setError(undefined);
    const major = Number(value.replace(/,/g, ''));
    if (!Number.isFinite(major) || major < 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required for the audit log.');
      return;
    }
    const valueMinor = Math.round(major * 10 ** decimalsFor(limit.currency));
    update.mutate(
      { id: limit.id, valueMinor },
      {
        onSuccess: () => {
          setNotice(
            `Updated ${limit.label}. Sensitive changes may require maker-checker approval before they take effect.`,
          );
          cancel();
        },
        onError: (e) => setError((e as Error)?.message ?? 'Update failed. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Risk Limits" subtitle="Exposure controls" />

      {limits.isLoading ? (
        <StateView kind="loading" message="Loading limits…" />
      ) : limits.isError ? (
        <StateView
          kind="error"
          title="Couldn't load risk limits"
          message={(limits.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => limits.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Gauge" title="No limits set" message="Exposure controls will appear here." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={limits.isRefetching} onRefresh={() => limits.refetch()} tintColor={Colors.primary} />
          }
        >
          {!allowed ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Read-only — your role can't change risk limits.</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={[styles.banner, styles.noticeBanner]}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <ListCard flush>
            {list.map((limit, i, arr) => {
              const editing = editingId === limit.id;
              const last = i === arr.length - 1;
              if (editing) {
                return (
                  <View key={limit.id} style={[styles.editor, !last && styles.editorBorder]}>
                    <Text style={styles.editorLabel}>{limit.label}</Text>
                    <Text style={styles.editorScope}>{limit.scope}</Text>
                    <TextInputField
                      label={`Value (${limit.currency})`}
                      value={value}
                      onChangeText={setValue}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                    <ReasonPrompt value={reason} onChangeText={setReason} error={error} />
                    <Text style={styles.makerNote}>
                      Sensitive changes route through maker-checker before they go live.
                    </Text>
                    <View style={styles.actions}>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Cancel" variant="secondary" onPress={cancel} disabled={update.isPending} />
                      </View>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Save" onPress={() => submit(limit)} loading={update.isPending} />
                      </View>
                    </View>
                  </View>
                );
              }
              return (
                <DataRow
                  key={limit.id}
                  label={limit.label}
                  sublabel={limit.scope}
                  value={formatMoney(limit.valueMinor, limit.currency)}
                  onPress={allowed ? () => beginEdit(limit) : undefined}
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
    borderRadius: Spacing.sm,
  },
  bannerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  noticeBanner: { backgroundColor: Colors.iconBgTeal },
  noticeText: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  editor: { paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.md, gap: 2 },
  editorBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  editorLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  editorScope: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  makerNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: { flex: 1 },
});
