import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { CheckCircle2, Download, Lock, FileText, Layers, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useBundle, useBundleManifest, useMe, useWallet, useCreateOrder, usePayOrder, useBnplOrder } from '@/features/academy/hooks';
import { formatNaira } from '@/features/academy/constants';

/** W6 — Bundle/item detail. Contents, price, buy (wallet or BNPL). Minor-gated. */
export default function BundleDetail() {
  const { bundleId } = useLocalSearchParams<{ bundleId: string }>();
  const bundle = useBundle(bundleId);
  const manifest = useBundleManifest(bundleId);
  const me = useMe();
  const wallet = useWallet();
  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const bnpl = useBnplOrder();

  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locked = me.data?.isMinor && me.data?.guardianConsent !== 'granted';

  const buy = (method: 'wallet' | 'bnpl') => {
    if (!bundle.data) return;
    setError(null);
    createOrder.mutate(
      { bundleId },
      {
        onSuccess: (order) => {
          if (method === 'wallet') {
            payOrder.mutate(
              { orderId: order.id, amountKobo: order.amountKobo, bundleId },
              { onSuccess: () => setDone('Unlocked! Items are downloading for offline use.'), onError: (e) => setError(msg(e)) },
            );
          } else {
            bnpl.mutate(
              { orderId: order.id, amountKobo: order.amountKobo, instalments: 3, bundleId },
              { onSuccess: () => setDone('On BNPL — 3 instalments. Access unlocked now.'), onError: (e) => setError(msg(e)) },
            );
          }
        },
        onError: (e) => setError(msg(e)),
      },
    );
  };

  if (bundle.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading bundle…" /></SafeAreaView>;
  if (!bundle.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Bundle" /><StateView kind="error" title="Bundle not found" /></SafeAreaView>;

  const busy = createOrder.isPending || payOrder.isPending || bnpl.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={bundle.data.name} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.desc}>{bundle.data.description}</Text>
        <View style={styles.statRow}>
          <View style={[styles.stat, shadow1]}><Layers size={18} color={Colors.secondary} /><Text style={styles.statVal}>{bundle.data.itemCount}</Text><Text style={styles.statLabel}>items</Text></View>
          <View style={[styles.stat, shadow1]}><Download size={18} color={Colors.teal} /><Text style={styles.statVal}>{bundle.data.dataBudgetMb}MB</Text><Text style={styles.statLabel}>data</Text></View>
          <View style={[styles.stat, shadow1]}><Wallet size={18} color={Colors.primary} /><Text style={styles.statVal}>{formatNaira(bundle.data.priceKobo)}</Text><Text style={styles.statLabel}>price</Text></View>
        </View>

        <Text style={styles.section}>What’s inside</Text>
        {manifest.data?.length ? manifest.data.map((m) => (
          <View key={m.id} style={[styles.manifestRow, shadow1]}>
            <FileText size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.manifestTitle}>{m.title}</Text>
            <Text style={styles.manifestSize}>{Math.round(m.sizeKb / 1024 * 10) / 10}MB</Text>
          </View>
        )) : <Text style={styles.manifestSize}>Manifest available after purchase.</Text>}

        {done ? (
          <View style={styles.doneCard}><CheckCircle2 size={18} color={Colors.teal} /><Text style={styles.doneText}>{done}</Text></View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {locked ? (
          <View style={styles.lockCard}><Lock size={16} color={Colors.onWarning} /><Text style={styles.lockText}>A parent or guardian must consent before you can purchase.</Text></View>
        ) : (
          <Text style={styles.walletNote}>Wallet balance: {formatNaira(wallet.data?.spendableKobo)}</Text>
        )}
      </ScrollView>
      {!done ? (
        <View style={styles.footer}>
          <PrimaryButton label="Buy with wallet" onPress={() => buy('wallet')} disabled={locked} loading={busy} />
          {bundle.data.bnplEligible ? (
            <PrimaryButton label="Pay later (BNPL · 3x)" variant="secondary" onPress={() => buy('bnpl')} disabled={locked || busy} />
          ) : null}
        </View>
      ) : (
        <View style={styles.footer}><PrimaryButton label="Done" onPress={() => goBack('/learn/academy/store')} /></View>
      )}
    </SafeAreaView>
  );
}

function msg(e: unknown) { return e instanceof Error ? e.message : 'Purchase failed'; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  statRow: { flexDirection: 'row', gap: Spacing.sm },
  stat: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  statVal: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  manifestRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.md },
  manifestTitle: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  manifestSize: { ...Typography.caption, color: Colors.onSurfaceVariant },
  doneCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, padding: Spacing.md, borderRadius: Radius.lg },
  doneText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
  lockCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, padding: Spacing.md, borderRadius: Radius.md },
  lockText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  walletNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, gap: Spacing.sm },
});
