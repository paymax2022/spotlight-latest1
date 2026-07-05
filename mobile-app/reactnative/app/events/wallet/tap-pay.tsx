import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Nfc, CheckCircle2, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEventWallet, useVendors, useChargeVendor } from '@/features/events/hooks';
import { EventColors, formatNaira } from '@/features/events/constants/events.constants';
import type { EventVendorDisplay } from '@/features/events/types';

export default function TapPay() {
  const params = useLocalSearchParams<{ eventId: string; walletId: string }>();
  const eventId = params.eventId ?? 'e_live';
  const walletId = params.walletId ?? '';
  const wallet = useEventWallet(walletId);
  const vendors = useVendors(eventId);
  const charge = useChargeVendor(walletId);

  const [active, setActive] = useState<EventVendorDisplay | null>(null);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [paid, setPaid] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const total = active ? active.items.reduce((s, it) => s + it.priceKobo * (picked[it.id] ?? 0), 0) : 0;

  const open = (v: EventVendorDisplay) => { setActive(v); setPicked({}); setErr(null); };
  const inc = (id: string, d: number) => setPicked((p) => ({ ...p, [id]: Math.max(0, (p[id] ?? 0) + d) }));

  const tapToPay = async () => {
    if (!active || total <= 0) return;
    setErr(null);
    try {
      await charge.mutateAsync({ vendorId: active.id, amountKobo: total });
      setPaid(total);
      setActive(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed.');
    }
  };

  const loading = wallet.isLoading || vendors.isLoading;
  const errored = wallet.isError || vendors.isError;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tap to pay" subtitle="Closed-loop event wallet" />
      {loading ? (
        <StateView kind="loading" message="Loading vendors…" />
      ) : errored ? (
        <StateView kind="error" title="Couldn't load vendors" message="Please try again." actionLabel="Retry" onAction={() => { wallet.refetch(); vendors.refetch(); }} />
      ) : (vendors.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No vendors yet" message="Vendors will appear here when the event goes live." icon="Store" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.balPill}>
            <Text style={styles.balPillText}>Balance: {formatNaira(wallet.data?.balance_kobo ?? 0)}</Text>
          </View>
          {vendors.data!.map((v) => (
            <Pressable key={v.id} onPress={() => open(v)} style={({ pressed }) => [styles.vendor, pressed && { opacity: 0.9 }]}>
              <Text style={styles.vendorEmoji}>{v.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.vendorName}>{v.name}</Text>
                <Text style={styles.vendorCat}>{v.category} · {v.items.length} items</Text>
              </View>
              <Nfc size={22} color={EventColors.brand} />
            </Pressable>
          ))}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}

      {/* Vendor charge sheet */}
      <Modal visible={!!active} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{active?.name}</Text>
              <Pressable onPress={() => setActive(null)} hitSlop={10}><X size={22} color={EventColors.muted} /></Pressable>
            </View>
            {active?.items.map((it) => (
              <View key={it.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{it.name}</Text>
                  <Text style={styles.itemPrice}>{formatNaira(it.priceKobo)}</Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable onPress={() => inc(it.id, -1)} style={styles.stepBtn}><Text style={styles.stepBtnText}>−</Text></Pressable>
                  <Text style={styles.stepVal}>{picked[it.id] ?? 0}</Text>
                  <Pressable onPress={() => inc(it.id, 1)} style={styles.stepBtn}><Text style={styles.stepBtnText}>+</Text></Pressable>
                </View>
              </View>
            ))}
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <View style={styles.tapHint}><Nfc size={18} color={EventColors.brand} /><Text style={styles.tapHintText}>Tap your phone to the vendor terminal</Text></View>
            <PrimaryButton label={total > 0 ? `Pay ${formatNaira(total)}` : 'Select items'} disabled={total <= 0} loading={charge.isPending} onPress={tapToPay} />
          </View>
        </View>
      </Modal>

      {/* Success */}
      <Modal visible={paid != null} transparent animationType="fade" onRequestClose={() => setPaid(null)}>
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <CheckCircle2 size={56} color={EventColors.ok} />
            <Text style={styles.successTitle}>Paid {paid != null ? formatNaira(paid) : ''}</Text>
            <Text style={styles.successSub}>Charged to your event wallet.</Text>
            <PrimaryButton label="Done" onPress={() => setPaid(null)} />
            <Pressable onPress={() => { setPaid(null); router.push({ pathname: '/events/wallet/history', params: { eventId, walletId } }); }}>
              <Text style={styles.viewHistory}>View spend history</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  balPill: { alignSelf: 'flex-start', backgroundColor: EventColors.okBg, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  balPillText: { ...Typography.labelMd, color: EventColors.ok },
  vendor: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  vendorEmoji: { fontSize: 30 },
  vendorName: { ...Typography.titleMd, color: Colors.onSurface },
  vendorCat: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  itemName: { ...Typography.labelLg, color: Colors.onSurface },
  itemPrice: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { ...Typography.titleMd, color: Colors.onSurface },
  stepVal: { ...Typography.labelLg, color: Colors.onSurface, minWidth: 18, textAlign: 'center' },
  err: { ...Typography.bodySm, color: EventColors.danger, marginTop: Spacing.sm },
  tapHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center', marginVertical: Spacing.sm },
  tapHintText: { ...Typography.bodySm, color: EventColors.muted },
  successBackdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.55)', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  successCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm, width: '100%' },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: EventColors.muted, marginBottom: Spacing.sm },
  viewHistory: { ...Typography.labelMd, color: EventColors.brand, marginTop: Spacing.sm },
});
