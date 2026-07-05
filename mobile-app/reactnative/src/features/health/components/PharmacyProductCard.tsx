import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Pill, Star, ShieldCheck, Store } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { formatNaira } from '../constants/health.constants';
import type { PharmacyProduct } from '../pharmacy/types';

/**
 * Catalog product card. Surfaces NAFDAC reg (HL-5) and the Rx-required flag
 * (HL-3) so the customer always sees prescription gating before adding to cart.
 */
export default function PharmacyProductCard({
  product,
  onPress,
}: {
  product: PharmacyProduct;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={product.name}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={[styles.thumb, { backgroundColor: product.imageColor }]}>
        <Pill size={26} color={Colors.secondary} strokeWidth={2} />
        {product.rxRequired ? (
          <View style={styles.rxTag}>
            <Text style={styles.rxTagText}>Rx</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {product.name}
      </Text>
      <Text style={styles.form} numberOfLines={1}>
        {product.brand} · {product.form}
      </Text>

      <View style={styles.nafdacRow}>
        <ShieldCheck size={11} color={Colors.teal} strokeWidth={2.2} />
        <Text style={styles.nafdac} numberOfLines={1}>
          NAFDAC {product.nafdacReg}
        </Text>
      </View>

      {product.pharmacyName ? (
        <View style={styles.pharmacyRow}>
          <Store size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.pharmacy} numberOfLines={1}>
            {product.pharmacyName}
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.price}>{formatNaira(product.priceKobo)}</Text>
        <View style={styles.rating}>
          <Star size={11} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
          <Text style={styles.ratingText}>{product.rating.toFixed(1)}</Text>
        </View>
      </View>

      {!product.inStock ? <Text style={styles.oos}>Out of stock</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.sm + 2,
    gap: 3,
  },
  pressed: { opacity: 0.9 },
  thumb: {
    height: 72,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  rxTag: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: Colors.secondary,
    borderRadius: Radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  rxTagText: { ...Typography.caption, color: Colors.onSecondary, fontWeight: '700' as const },
  name: { ...Typography.labelLg, fontSize: 14, color: Colors.onSurface },
  form: { ...Typography.caption, color: Colors.onSurfaceVariant },
  nafdacRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  nafdac: { ...Typography.caption, color: Colors.teal, flex: 1 },
  pharmacyRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  pharmacy: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  price: { ...Typography.labelLg, fontSize: 15, color: Colors.primary },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  oos: { ...Typography.caption, color: Colors.error, marginTop: 2 },
});
