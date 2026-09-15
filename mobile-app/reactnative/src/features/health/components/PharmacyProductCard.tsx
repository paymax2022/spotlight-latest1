import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Pill, Star, ShieldCheck, Store, Plus, Minus, ShoppingCart } from 'lucide-react-native';
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
 *
 * Add-to-cart is OPT-IN: pass `onAdd` and the card grows an inline control, so
 * a catalog grid can sell directly instead of routing through the detail screen
 * for every item. Omit it and the card renders exactly as before.
 *
 * Rx-only medicines can be added here the same way the detail screen adds them —
 * the prescription gate is downstream and unconditional (the cart refuses to
 * proceed past "Upload Rx to continue" until a pharmacist-verified Rx exists),
 * so nothing is bypassed by adding one from a grid. The Rx chip on the
 * thumbnail is what tells the customer before they tap.
 */
export default function PharmacyProductCard({
  product,
  onPress,
  onAdd,
  inCartQty = 0,
  onSetQty,
}: {
  product: PharmacyProduct;
  onPress: () => void;
  /** Add one unit. Providing this is what turns on the inline cart control. */
  onAdd?: () => void;
  /** Units of this product already in the cart — drives the stepper. */
  inCartQty?: number;
  /** Set the cart quantity (0 removes the line). Enables -/+ once in cart. */
  onSetQty?: (qty: number) => void;
}) {
  // Out-of-stock items never get a control: the card already says so, and the
  // cart must not be able to hold something the pharmacy cannot dispense.
  const showCartControl = Boolean(onAdd) && product.inStock;
  return (
    // The card itself is a plain View. Its body and its cart control are two
    // SEPARATE pressables side by side, never nested: react-native-web renders
    // `accessibilityRole="button"` as a real <button>, and a <button> inside a
    // <button> is invalid HTML — React logs a hydration error and screen
    // readers cannot address the inner control.
    <View style={[styles.card, shadow1]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={product.name}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
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

      {showCartControl ? (
        inCartQty > 0 && onSetQty ? (
          <View style={styles.stepper}>
            <Pressable
              onPress={() => onSetQty(inCartQty - 1)}
              hitSlop={6}
              style={styles.stepBtn}
              accessibilityRole="button"
              accessibilityLabel={
                inCartQty === 1 ? `Remove ${product.name} from cart` : `Decrease ${product.name} quantity`
              }
            >
              <Minus size={14} color={Colors.primary} strokeWidth={2.4} />
            </Pressable>
            <Text style={styles.stepQty} accessibilityLabel={`${inCartQty} in cart`}>
              {inCartQty}
            </Text>
            <Pressable
              onPress={() => onSetQty(inCartQty + 1)}
              hitSlop={6}
              style={styles.stepBtn}
              accessibilityRole="button"
              accessibilityLabel={`Increase ${product.name} quantity`}
            >
              <Plus size={14} color={Colors.primary} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onAdd}
            style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${product.name} to cart`}
          >
            <ShoppingCart size={14} color={Colors.onPrimary} strokeWidth={2.2} />
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        )
      ) : null}
    </View>
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
  body: { gap: 3 },
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
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: Spacing.xs,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 7,
  },
  addBtnText: { ...Typography.labelMd, color: Colors.onPrimary },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
  },
  stepBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  stepQty: { ...Typography.labelMd, color: Colors.primary },
});
