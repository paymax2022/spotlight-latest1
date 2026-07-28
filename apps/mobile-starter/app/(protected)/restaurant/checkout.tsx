// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { placeRestaurantOrder } from '@/api/restaurant.api';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';
import type { CartItem } from '@/types/fintech';

export default function RestaurantCheckoutScreen() {
  const { restaurantId, cartJson } = useLocalSearchParams<{ restaurantId: string; cartJson: string }>();
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cart: CartItem[] = cartJson ? JSON.parse(cartJson) : [];
  const subtotal = cart.reduce((s, ci) => s + ci.item.price_kobo * ci.quantity, 0);
  const deliveryFee = 50000; // 500 NGN default
  const total = subtotal + deliveryFee;

  const mutation = useMutation({
    mutationFn: () =>
      placeRestaurantOrder({
        restaurant_id: restaurantId,
        items: cart.map((ci) => ({ menu_item_id: ci.item.id, quantity: ci.quantity })),
        delivery_address: address.trim(),
        notes: notes.trim() || undefined,
      }),
    onSuccess: (result) => {
      router.replace(`/orders/${result.order_id}` as never);
    },
    onError: (err: any) => {
      setError(err?.message || 'Failed to place order. Please try again.');
    },
  });

  function handlePlaceOrder() {
    setError(null);
    if (!address.trim()) { setError('Please enter a delivery address'); return; }
    mutation.mutate();
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.neutral.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Order Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          {cart.map((ci) => (
            <View key={ci.item.id} style={styles.orderRow}>
              <Text style={styles.orderQty}>{ci.quantity}×</Text>
              <Text style={styles.orderName} numberOfLines={1}>{ci.item.name}</Text>
              <Text style={styles.orderPrice}>{formatCurrency(ci.item.price_kobo * ci.quantity, 'NGN')}</Text>
            </View>
          ))}
        </View>

        {/* Delivery Address */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>
          <View style={styles.inputBox}>
            <Ionicons name="location-outline" size={18} color={colors.neutral.placeholder} />
            <TextInput
              style={styles.input}
              placeholder="Enter delivery address"
              placeholderTextColor={colors.neutral.placeholder}
              value={address}
              onChangeText={setAddress}
              multiline
            />
          </View>
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Notes (optional)</Text>
          <View style={styles.inputBox}>
            <TextInput
              style={[styles.input, { minHeight: 60 }]}
              placeholder="Any special instructions?"
              placeholderTextColor={colors.neutral.placeholder}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>
        </View>

        {/* Price Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment</Text>
          <View style={styles.card}>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Subtotal</Text>
              <Text style={styles.priceValue}>{formatCurrency(subtotal, 'NGN')}</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Delivery Fee</Text>
              <Text style={styles.priceValue}>{formatCurrency(deliveryFee, 'NGN')}</Text>
            </View>
            <View style={[styles.priceRow, styles.priceTotal]}>
              <Text style={styles.priceTotalLabel}>Total</Text>
              <Text style={styles.priceTotalValue}>{formatCurrency(total, 'NGN')}</Text>
            </View>
            <View style={styles.paymentMethod}>
              <Ionicons name="wallet-outline" size={18} color={colors.primary.DEFAULT} />
              <Text style={styles.paymentMethodText}>Paymax Wallet</Text>
              <Ionicons name="checkmark-circle" size={18} color="#00B894" />
            </View>
          </View>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {/* Place Order Button */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.placeBtn, mutation.isPending && styles.placeBtnDisabled]}
          onPress={handlePlaceOrder}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.placeBtnText}>Place Order</Text>
              <Text style={styles.placeBtnTotal}>{formatCurrency(total, 'NGN')}</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.neutral.white },
  content: { padding: 20, gap: 20, paddingBottom: 100 },
  section: {},
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 10 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  orderQty: { fontSize: 14, fontWeight: '700', color: colors.primary.DEFAULT, width: 24 },
  orderName: { flex: 1, fontSize: 14, color: colors.neutral.text },
  orderPrice: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.neutral.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  input: { flex: 1, fontSize: 14, color: colors.neutral.text },
  card: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLabel: { fontSize: 14, color: colors.neutral.textMuted },
  priceValue: { fontSize: 14, color: colors.neutral.text },
  priceTotal: { borderTopWidth: 1, borderTopColor: colors.neutral.border, paddingTop: 10, marginTop: 2 },
  priceTotalLabel: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  priceTotalValue: { fontSize: 16, fontWeight: '800', color: colors.primary.DEFAULT },
  paymentMethod: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.neutral.surfaceAlt,
    borderRadius: 10,
    padding: 10,
  },
  paymentMethodText: { flex: 1, fontSize: 14, color: colors.neutral.text, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  footer: { padding: 20, paddingTop: 10, backgroundColor: colors.neutral.background },
  placeBtn: {
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: colors.primary.DEFAULT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  placeBtnDisabled: { opacity: 0.6 },
  placeBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  placeBtnTotal: { fontSize: 16, fontWeight: '800', color: 'rgba(255,255,255,0.8)' },
});
