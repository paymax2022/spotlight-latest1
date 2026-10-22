import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Pill, Minus, Plus, Trash2, ScrollText, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCartStore } from '@/features/health/pharmacy/cartStore';
import { usePrescriptions } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function CartScreen() {
  const lines = useCartStore((s) => s.lines);
  const cart = useCartStore((s) => s.cart());
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);
  const { data: prescriptions } = usePrescriptions();

  // HL-3: the order needs a prescription reference the pharmacist can confirm — an
  // e-Rx already sent to a pharmacy counts, one still sitting in the wallet does not.
  const verifiedRx = (prescriptions ?? []).some((r) => r.status === 'verified');
  const hasRx = verifiedRx || (prescriptions ?? []).some((r) => r.status === 'verifying');

  if (lines.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cart" />
        <StateView
          kind="empty"
          icon="ShoppingCart"
          title="Your cart is empty"
          message="Browse medicines and add them to your cart."
          actionLabel="Browse medicines"
          onAction={() => router.push('/health/pharmacy/search')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Cart" subtitle={`${lines.length} item${lines.length > 1 ? 's' : ''}`} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {lines.map((l) => (
          <View key={l.productId} style={[styles.line, shadow1]}>
            <View style={[styles.thumb, { backgroundColor: l.imageColor }]}>
              <Pill size={22} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={styles.lineBody}>
              <Text style={styles.lineName} numberOfLines={1}>
                {l.name}
              </Text>
              <Text style={styles.lineForm} numberOfLines={1}>
                {l.form}
              </Text>
              {l.rxRequired ? (
                <View style={styles.rxTag}>
                  <ScrollText size={11} color={Colors.secondary} strokeWidth={2.2} />
                  <Text style={styles.rxTagText}>Rx required</Text>
                </View>
              ) : null}
              <Text style={styles.linePrice}>{formatNaira(l.priceKobo * l.qty)}</Text>
            </View>
            <View style={styles.qtyCol}>
              <View style={styles.qtyRow}>
                <Pressable style={styles.qtyBtn} onPress={() => setQty(l.productId, l.qty - 1)}>
                  <Minus size={15} color={Colors.onSurface} strokeWidth={2} />
                </Pressable>
                <Text style={styles.qtyValue}>{l.qty}</Text>
                <Pressable style={styles.qtyBtn} onPress={() => setQty(l.productId, l.qty + 1)}>
                  <Plus size={15} color={Colors.onSurface} strokeWidth={2} />
                </Pressable>
              </View>
              <Pressable onPress={() => remove(l.productId)} hitSlop={8} style={styles.removeBtn}>
                <Trash2 size={15} color={Colors.error} strokeWidth={2} />
              </Pressable>
            </View>
          </View>
        ))}

        {/* Rx gate (HL-3) */}
        {cart.requiresRx ? (
          <View style={[styles.rxGate, hasRx ? styles.rxGateOk : styles.rxGateWarn]}>
            <ScrollText size={16} color={hasRx ? Colors.teal : Colors.onWarning} strokeWidth={2} />
            <Text style={[styles.rxGateText, { color: hasRx ? Colors.tertiaryContainer : Colors.onWarning }]}>
              {verifiedRx
                ? 'A verified prescription will be attached at checkout.'
                : hasRx
                ? 'Your e-Rx is with a pharmacist. It will be attached here and the order confirms once they verify it.'
                : 'This order contains prescription-only medicine. A doctor issues it as an e-Rx — send one to the pharmacy to continue.'}
            </Text>
            {!hasRx ? (
              <Pressable onPress={() => router.push('/health/pharmacy/send-rx')}>
                <Text style={styles.rxGateLink}>Send</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Totals */}
        <View style={[styles.totals, shadow1]}>
          <Row label="Subtotal" value={formatNaira(cart.subtotalKobo)} />
          <Row
            label="Rider’s fare"
            value={cart.deliveryFeeKobo ? `${formatNaira(cart.deliveryFeeKobo)} separately` : 'Set at checkout'}
            muted
          />
          <View style={styles.divider} />
          <Row label="Held with this order" value={formatNaira(cart.totalKobo)} bold />
        </View>

        <View style={styles.safety}>
          <ShieldCheck size={13} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.safetyText}>
            The pharmacy holds your medicine payment and it is released on delivery or pickup. The rider’s fare is settled
            separately and is not part of the held amount.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={cart.requiresRx && !hasRx ? 'Send an e-Rx to continue' : 'Continue to checkout'}
          onPress={() =>
            cart.requiresRx && !hasRx
              ? router.push('/health/pharmacy/send-rx')
              : router.push('/health/pharmacy/pharmacy-select')
          }
        />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, bold && styles.totalBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalBold, muted && styles.totalMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
  line: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  thumb: { width: 52, height: 52, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  lineBody: { flex: 1, gap: 2 },
  lineName: { ...Typography.labelLg, color: Colors.onSurface },
  lineForm: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rxTag: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', marginTop: 2 },
  rxTagText: { ...Typography.caption, color: Colors.secondary, fontWeight: '700' as const },
  linePrice: { ...Typography.labelLg, color: Colors.primary, marginTop: 2 },
  qtyCol: { alignItems: 'flex-end', justifyContent: 'space-between' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: Radius.DEFAULT,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: { ...Typography.labelLg, color: Colors.onSurface, minWidth: 18, textAlign: 'center' },
  removeBtn: { padding: 4 },
  rxGate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.xs },
  rxGateOk: { backgroundColor: Colors.iconBgTeal },
  rxGateWarn: { backgroundColor: Colors.iconBgGold },
  rxGateText: { ...Typography.bodySm, flex: 1, lineHeight: 18 },
  rxGateLink: { ...Typography.labelMd, color: Colors.secondary },
  totals: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  totalValue: { ...Typography.bodyMd, color: Colors.onSurface },
  totalMuted: { color: Colors.onSurfaceVariant },
  totalBold: { ...Typography.titleMd, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  safety: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, marginTop: Spacing.xs },
  safetyText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
