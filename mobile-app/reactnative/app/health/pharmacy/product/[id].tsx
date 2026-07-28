import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Pill, ShieldCheck, Star, Minus, Plus, ScrollText, ShoppingCart, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useProduct } from '@/features/health/pharmacy/hooks';
import { useCartStore } from '@/features/health/pharmacy/cartStore';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: p, isLoading, isError, refetch } = useProduct(id);
  const add = useCartStore((s) => s.add);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const onAdd = () => {
    if (!p) return;
    add(p, qty);
    setAdded(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Product" />

      {isLoading ? (
        <StateView kind="loading" message="Loading product…" />
      ) : isError || !p ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Image */}
            <View style={[styles.image, { backgroundColor: p.imageColor }]}>
              <Pill size={56} color={Colors.secondary} strokeWidth={1.6} />
            </View>

            {/* Title block */}
            <View style={styles.titleBlock}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.brand}>
                {p.brand} · {p.form}
              </Text>
              <View style={styles.metaRow}>
                <View style={styles.rating}>
                  <Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                  <Text style={styles.ratingText}>
                    {p.rating.toFixed(1)} ({p.reviewCount})
                  </Text>
                </View>
                <Text style={styles.price}>{formatNaira(p.priceKobo)}</Text>
              </View>
            </View>

            {/* NAFDAC + Rx flags (HL-5 / HL-3) */}
            <View style={styles.flags}>
              <View style={[styles.flag, { backgroundColor: Colors.iconBgTeal }]}>
                <ShieldCheck size={15} color={Colors.teal} strokeWidth={2.2} />
                <Text style={[styles.flagText, { color: Colors.tertiaryContainer }]}>NAFDAC {p.nafdacReg}</Text>
              </View>
              {p.rxRequired ? (
                <View style={[styles.flag, { backgroundColor: Colors.iconBgBlue }]}>
                  <ScrollText size={15} color={Colors.secondary} strokeWidth={2.2} />
                  <Text style={[styles.flagText, { color: Colors.secondary }]}>Prescription required</Text>
                </View>
              ) : (
                <View style={[styles.flag, { backgroundColor: Colors.iconBgGold }]}>
                  <Text style={[styles.flagText, { color: Colors.onWarning }]}>Over the counter</Text>
                </View>
              )}
            </View>

            {/* Rx gate notice */}
            {p.rxRequired ? (
              <Pressable style={styles.rxNotice} onPress={() => router.push('/health/pharmacy/upload-rx')}>
                <Info size={15} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.rxNoticeText}>
                  This medicine needs a pharmacist-verified prescription. Upload one to complete checkout.
                </Text>
              </Pressable>
            ) : null}

            {/* Description */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.body}>{p.description}</Text>
            </View>

            {p.activeIngredient ? <DetailRow label="Active ingredient" value={p.activeIngredient} /> : null}
            {p.usage ? <DetailRow label="Usage" value={p.usage} /> : null}
            {p.sideEffects ? <DetailRow label="Side effects" value={p.sideEffects} /> : null}
            {p.storage ? <DetailRow label="Storage" value={p.storage} /> : null}
            <DetailRow label="Manufacturer" value={p.manufacturer} />
            {p.pharmacyName ? <DetailRow label="Sold by" value={p.pharmacyName} /> : null}

            {/* Quantity */}
            <View style={styles.qtyBlock}>
              <Text style={styles.sectionTitle}>Quantity</Text>
              <View style={styles.qtyRow}>
                <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>
                  <Minus size={18} color={qty <= 1 ? Colors.outline : Colors.onSurface} strokeWidth={2} />
                </Pressable>
                <Text style={styles.qtyValue}>{qty}</Text>
                <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => q + 1)}>
                  <Plus size={18} color={Colors.onSurface} strokeWidth={2} />
                </Pressable>
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            {!p.inStock ? (
              <PrimaryButton label="Out of stock" onPress={() => {}} disabled />
            ) : added ? (
              <View style={styles.footerRow}>
                <PrimaryButton label="Keep shopping" variant="secondary" onPress={() => router.back()} style={styles.footerBtn} />
                <PrimaryButton label="Go to cart" onPress={() => router.push('/health/pharmacy/cart')} style={styles.footerBtn} />
              </View>
            ) : (
              <Pressable style={styles.addCta} onPress={onAdd}>
                <ShoppingCart size={20} color={Colors.onPrimary} strokeWidth={2} />
                <Text style={styles.addCtaText}>Add to cart</Text>
                <Text style={styles.addCtaAmount}>{formatNaira(p.priceKobo * qty)}</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: 40 },
  image: { height: 180, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { gap: 4 },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  brand: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  price: { ...Typography.titleLg, color: Colors.primary },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 7 },
  flagText: { ...Typography.labelSm, fontWeight: '700' as const },
  rxNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.secondary,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  rxNoticeText: { ...Typography.bodySm, color: Colors.secondary, flex: 1, lineHeight: 18 },
  section: { gap: 6 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  detailRow: { gap: 2 },
  detailLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  detailValue: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 21 },
  qtyBlock: { gap: Spacing.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  qtyBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
  },
  qtyValue: { ...Typography.titleLg, color: Colors.onSurface, minWidth: 28, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  footerRow: { flexDirection: 'row', gap: Spacing.md },
  footerBtn: { flex: 1 },
  addCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    height: 56,
    paddingHorizontal: Spacing.lg,
  },
  addCtaText: { ...Typography.labelLg, color: Colors.onPrimary, flex: 1 },
  addCtaAmount: { ...Typography.labelLg, color: Colors.onPrimary },
});
