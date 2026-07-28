// ── Paymax · Admin Console — Asset controls ──────────────────────────────────
// Trading controls per tradable asset, filtered by kind (crypto / stock) and
// searchable by symbol. Each asset → AssetControlRow with buy/sell/withdrawal
// toggles. With `asset.config` a sensitive toggle requires a reason (collected in
// a confirm sheet) before it calls useUpdateAssetControl().mutate({id, patch});
// the change may enter a maker-checker pending state (surfaced from the response).
// Fee / min / max are editable via a small inline editor, also permission-gated.
// Without permission everything renders read-only (disabled).

import React, { useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SlidersHorizontal } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow2 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { AdminHeader, ListCard, AssetControlRow, ReasonPrompt } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useAssetControls, useUpdateAssetControl } from '@/features/admin/hooks/useAdmin';
import { can, formatBps, formatMoney } from '@/features/admin/constants/admin.constants';
import type { AssetControl, AssetControlPatch } from '@/features/admin/types/admin.types';

type KindFilter = 'crypto' | 'stock';
type ToggleField = 'buyEnabled' | 'sellEnabled' | 'withdrawalEnabled';

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'crypto', label: 'Crypto' },
  { value: 'stock', label: 'Stock' },
];

const TOGGLE_LABEL: Record<ToggleField, string> = {
  buyEnabled: 'Buy',
  sellEnabled: 'Sell',
  withdrawalEnabled: 'Withdraw',
};

const FIAT_DECIMALS: Record<string, number> = { NGN: 2, USD: 2 };
const decimalsFor = (currency: string) => FIAT_DECIMALS[currency] ?? 8;

interface PendingToggle {
  asset: AssetControl;
  field: ToggleField;
  next: boolean;
}

export default function AdminAssetsScreen() {
  const { role } = useAdminRole();
  const canEdit = can(role, 'asset.config');

  const assets = useAssetControls();
  const update = useUpdateAssetControl();

  const [kind, setKind] = useState<KindFilter>('crypto');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | undefined>();

  // Sensitive-toggle confirm flow.
  const [pending, setPending] = useState<PendingToggle | null>(null);
  const [reason, setReason] = useState('');
  const [toggleError, setToggleError] = useState<string | undefined>();

  // Inline fee / min / max editor.
  const [editId, setEditId] = useState<string | null>(null);
  const [feeBps, setFeeBps] = useState('');
  const [minMajor, setMinMajor] = useState('');
  const [maxMajor, setMaxMajor] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editError, setEditError] = useState<string | undefined>();

  const list = assets.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((a) => a.kind === kind && (!q || a.symbol.toLowerCase().includes(q)));
  }, [list, kind, query]);

  // ─── Toggle (sensitive → reason required) ──────────────────────────────────
  const requestToggle = (asset: AssetControl, field: ToggleField, next: boolean) => {
    if (!canEdit) return;
    setNotice(undefined);
    setToggleError(undefined);
    setReason('');
    setPending({ asset, field, next });
  };

  const confirmToggle = () => {
    if (!pending) return;
    if (!reason.trim()) {
      setToggleError('A reason is required for the audit log.');
      return;
    }
    const patch: AssetControlPatch = { [pending.field]: pending.next };
    update.mutate(
      { id: pending.asset.id, patch },
      {
        onSuccess: (res) => {
          const label = TOGGLE_LABEL[pending.field];
          setNotice(
            `${pending.asset.symbol} · ${label} ${pending.next ? 'enabled' : 'disabled'}. ` +
              `Sensitive changes may require maker-checker approval before they take effect (status: ${res.status}).`,
          );
          setPending(null);
          setReason('');
        },
        onError: (e) => setToggleError((e as Error)?.message ?? 'Change failed. Please try again.'),
      },
    );
  };

  // ─── Inline fee / min / max editor ─────────────────────────────────────────
  const beginEdit = (asset: AssetControl) => {
    setEditId(asset.id);
    setFeeBps(String(asset.feeBps));
    setMinMajor(String(asset.minOrder.amount / 10 ** decimalsFor(asset.minOrder.currency)));
    setMaxMajor(String(asset.maxOrder.amount / 10 ** decimalsFor(asset.maxOrder.currency)));
    setEditReason('');
    setEditError(undefined);
    setNotice(undefined);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditError(undefined);
  };

  const saveEdit = (asset: AssetControl) => {
    setEditError(undefined);
    const fee = Number(feeBps);
    const min = Number(minMajor.replace(/,/g, ''));
    const max = Number(maxMajor.replace(/,/g, ''));
    if (!Number.isFinite(fee) || fee < 0) return setEditError('Enter a valid fee in basis points.');
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max < 0) {
      return setEditError('Enter valid min / max amounts.');
    }
    if (!editReason.trim()) return setEditError('A reason is required for the audit log.');

    const patch: AssetControlPatch = {
      feeBps: Math.round(fee),
      minOrder: { amount: Math.round(min * 10 ** decimalsFor(asset.minOrder.currency)), currency: asset.minOrder.currency },
      maxOrder: { amount: Math.round(max * 10 ** decimalsFor(asset.maxOrder.currency)), currency: asset.maxOrder.currency },
    };
    update.mutate(
      { id: asset.id, patch },
      {
        onSuccess: (res) => {
          setNotice(
            `${asset.symbol} pricing updated. Sensitive changes may require maker-checker approval (status: ${res.status}).`,
          );
          cancelEdit();
        },
        onError: (e) => setEditError((e as Error)?.message ?? 'Update failed. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Assets" subtitle="Trading controls" />

      <SearchBar placeholder="Search symbol" value={query} onChangeText={setQuery} />

      <View style={styles.filterWrap}>
        <SegmentedControl<KindFilter> options={FILTERS} value={kind} onChange={setKind} />
      </View>

      {assets.isLoading ? (
        <StateView kind="loading" message="Loading assets…" />
      ) : assets.isError ? (
        <StateView
          kind="error"
          title="Couldn't load assets"
          message={(assets.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => assets.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Coins" title="No assets" message="Tradable assets will appear here." />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No matches" message={`No ${kind} assets match this filter.`} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={assets.isRefetching} onRefresh={() => assets.refetch()} tintColor={Colors.primary} />
          }
        >
          {!canEdit ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Read-only — your role can't change asset controls.</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={[styles.banner, styles.noticeBanner]}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <ListCard flush>
            {filtered.map((asset, i, arr) => {
              const last = i === arr.length - 1;
              if (editId === asset.id) {
                return (
                  <View key={asset.id} style={[styles.editor, !last && styles.editorBorder]}>
                    <Text style={styles.editorTitle}>{asset.symbol} · pricing</Text>
                    <TextInputField label="Fee (bps)" value={feeBps} onChangeText={setFeeBps} keyboardType="numeric" placeholder="0" />
                    <TextInputField label={`Min order (${asset.minOrder.currency})`} value={minMajor} onChangeText={setMinMajor} keyboardType="numeric" placeholder="0" />
                    <TextInputField label={`Max order (${asset.maxOrder.currency})`} value={maxMajor} onChangeText={setMaxMajor} keyboardType="numeric" placeholder="0" />
                    <ReasonPrompt value={editReason} onChangeText={setEditReason} error={editError} />
                    <Text style={styles.makerNote}>Sensitive changes route through maker-checker before they go live.</Text>
                    <View style={styles.actions}>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Cancel" variant="secondary" onPress={cancelEdit} disabled={update.isPending} />
                      </View>
                      <View style={styles.actionBtn}>
                        <PrimaryButton label="Save" onPress={() => saveEdit(asset)} loading={update.isPending} />
                      </View>
                    </View>
                  </View>
                );
              }
              return (
                <View key={asset.id}>
                  <AssetControlRow
                    asset={asset}
                    canEdit={canEdit}
                    onToggle={(field, next) => requestToggle(asset, field as ToggleField, next)}
                    last
                  />
                  {canEdit ? (
                    <Pressable
                      onPress={() => beginEdit(asset)}
                      style={({ pressed }) => [styles.editTrigger, pressed && styles.pressed, !last && styles.editorBorder]}
                      accessibilityRole="button"
                    >
                      <SlidersHorizontal size={16} color={Colors.secondary} strokeWidth={2} />
                      <Text style={styles.editTriggerText}>
                        Edit fee / limits · {formatBps(asset.feeBps)} · {formatMoney(asset.minOrder.amount, asset.minOrder.currency)}–{formatMoney(asset.maxOrder.amount, asset.maxOrder.currency)}
                      </Text>
                    </Pressable>
                  ) : (
                    <View style={[styles.readMeta, !last && styles.editorBorder]}>
                      <Text style={styles.readMetaText}>
                        {formatBps(asset.feeBps)} · {formatMoney(asset.minOrder.amount, asset.minOrder.currency)}–{formatMoney(asset.maxOrder.amount, asset.maxOrder.currency)}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ListCard>
        </ScrollView>
      )}

      {/* Sensitive-toggle confirm: collect a reason before mutating. */}
      <Modal visible={!!pending} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <Pressable style={styles.backdrop} onPress={() => !update.isPending && setPending(null)}>
          <Pressable style={[styles.sheet, shadow2]} onPress={(e) => e.stopPropagation()}>
            {pending ? (
              <>
                <Text style={styles.sheetTitle}>
                  {pending.next ? 'Enable' : 'Disable'} {TOGGLE_LABEL[pending.field]}
                </Text>
                <Text style={styles.sheetSub}>
                  {pending.asset.symbol} · this is a sensitive change and is logged for audit.
                </Text>
                <ReasonPrompt value={reason} onChangeText={setReason} error={toggleError} />
                <Text style={styles.makerNote}>It may require maker-checker approval before taking effect.</Text>
                <View style={styles.actions}>
                  <View style={styles.actionBtn}>
                    <PrimaryButton label="Cancel" variant="secondary" onPress={() => setPending(null)} disabled={update.isPending} />
                  </View>
                  <View style={styles.actionBtn}>
                    <PrimaryButton label="Confirm" onPress={confirmToggle} loading={update.isPending} />
                  </View>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { marginBottom: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },
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
  editTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.cardPadding,
    paddingBottom: Spacing.md,
    paddingTop: 2,
  },
  editTriggerText: { ...Typography.labelSm, color: Colors.secondary, flex: 1 },
  pressed: { opacity: 0.6 },
  readMeta: { paddingHorizontal: Spacing.cardPadding, paddingBottom: Spacing.md, paddingTop: 2 },
  readMetaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  editorBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  editor: { paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.md },
  editorTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  makerNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.cardPadding,
    paddingBottom: Spacing.xl,
  },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
