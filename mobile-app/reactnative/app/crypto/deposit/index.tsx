import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Copy, Share2, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import QrCodeView from '@/components/QrCodeView';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import { useAssets, useDepositAddress } from '@/features/crypto/hooks/useCrypto';
import { formatCrypto } from '@/features/crypto/utils/cryptoFormatters';
import { copyText } from '@/features/crypto/utils/clipboard';
import { DEPOSIT_DISCLOSURE } from '@/features/crypto/constants/crypto.constants';

export default function DepositScreen() {
  const params = useLocalSearchParams<{ symbol?: string }>();
  const assets = useAssets();
  const depositable = useMemo(() => (assets.data ?? []).filter((a) => a.status === 'active' && a.depositEnabled), [assets.data]);

  const [symbolId, setSymbolId] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);

  const selected =
    depositable.find((a) => a.id === symbolId) ??
    depositable.find((a) => a.symbol === params.symbol) ??
    depositable[0];
  const networks = selected?.supportedNetworks ?? [];
  const activeNetwork = networks.find((n) => n.id === networkId) ?? networks[0];

  const deposit = useDepositAddress(selected?.symbol, activeNetwork?.id);

  if (assets.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Deposit crypto" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (!selected || !activeNetwork) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Deposit crypto" />
        <StateView kind="empty" icon="ArrowDownToLine" title="Deposits unavailable" message="No assets are open for deposit right now." actionLabel="Back to Crypto" onAction={() => router.replace('/crypto')} />
      </SafeAreaView>
    );
  }

  const d = deposit.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Deposit crypto" subtitle="From an external wallet" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Asset chooser */}
        <Text style={styles.label}>Asset</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {depositable.map((a) => {
            const active = a.id === selected.id;
            return (
              <Pressable key={a.id} onPress={() => { setSymbolId(a.id); setNetworkId(null); }} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <AssetIcon symbol={a.symbol} color={a.iconColor} size={24} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.symbol}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Network chooser */}
        <Text style={[styles.label, styles.mt]}>Network</Text>
        <View style={styles.netRow}>
          {networks.map((n) => {
            const active = n.id === activeNetwork.id;
            return (
              <Pressable key={n.id} onPress={() => setNetworkId(n.id)} style={[styles.netChip, active && styles.netChipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.netText, active && styles.netTextActive]}>{n.name}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Address + QR */}
        {deposit.isLoading || !d ? (
          <StateView kind="loading" message="Generating your address…" />
        ) : deposit.isError ? (
          <StateView kind="error" title="Couldn't load address" message="Please try again." actionLabel="Retry" onAction={() => deposit.refetch()} />
        ) : (
          <>
            <View style={styles.qrWrap}>
              <QrCodeView payload={d.address} size={180} />
            </View>

            <View style={styles.addrCard}>
              <Text style={styles.addrLabel}>{d.symbol} deposit address · {d.networkName}</Text>
              <Text style={styles.addrValue} selectable>{d.address}</Text>
              <View style={styles.addrActions}>
                <Pressable style={styles.actionBtn} onPress={() => copyText(d.address, `${d.symbol} deposit address`)} accessibilityRole="button" accessibilityLabel="Copy address">
                  <Copy size={16} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.actionText}>Copy</Text>
                </Pressable>
                <Pressable style={styles.actionBtn} onPress={() => copyText(d.address, `${d.symbol} deposit address`)} accessibilityRole="button" accessibilityLabel="Share address">
                  <Share2 size={16} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.actionText}>Share</Text>
                </Pressable>
              </View>
            </View>

            {/* Memo / destination tag */}
            {d.memo ? (
              <View style={styles.memoCard}>
                <View style={styles.flex}>
                  <Text style={styles.memoLabel}>Destination tag / memo (required)</Text>
                  <Text style={styles.memoValue} selectable>{d.memo}</Text>
                </View>
                <Pressable style={styles.actionBtn} onPress={() => copyText(d.memo as string, 'Deposit memo')} accessibilityRole="button" accessibilityLabel="Copy memo">
                  <Copy size={16} color={Colors.secondary} strokeWidth={2} />
                </Pressable>
              </View>
            ) : null}

            {/* Meta */}
            <View style={styles.metaCard}>
              <Meta label="Minimum deposit" value={formatCrypto(d.minDeposit.amount, d.symbol, selected.decimals)} />
              <Meta label="Credited after" value={`${d.confirmations} confirmations`} />
            </View>

            {/* Network warning */}
            <View style={styles.warn}>
              <TriangleAlert size={16} color={Colors.onWarning} strokeWidth={2} />
              <Text style={styles.warnText}>{DEPOSIT_DISCLOSURE}</Text>
            </View>
          </>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label="I've sent the deposit"
          onPress={() => router.push({ pathname: '/crypto/deposit/pending', params: { symbol: selected.symbol, networkName: activeNetwork.name, confirmations: String(activeNetwork.confirmations) } })}
          disabled={!d}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  flex: { flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  mt: { marginTop: Spacing.lg },
  chipRow: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.sm + 2, paddingVertical: 6,
  },
  chipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  netRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  netChip: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  netChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  netText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  netTextActive: { color: Colors.primary },
  qrWrap: { alignItems: 'center', marginVertical: Spacing.md },
  addrCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  addrLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addrValue: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
  addrActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  actionText: { ...Typography.labelMd, color: Colors.secondary },
  memoCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  memoLabel: { ...Typography.labelSm, color: Colors.onWarning },
  memoValue: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 1 },
  metaCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.sm },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  metaValue: { ...Typography.labelLg, color: Colors.onSurface },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  warnText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
