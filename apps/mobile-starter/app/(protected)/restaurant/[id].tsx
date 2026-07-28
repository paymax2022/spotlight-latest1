// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getRestaurant } from '@/api/restaurant.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';
import type { CartItem, MenuItem } from '@/types/fintech';

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  const query = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => getRestaurant(id),
  });

  if (query.isLoading) return <AppLoader />;
  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorState}>
          <Text style={styles.errorText}>Failed to load restaurant</Text>
          <Pressable style={styles.retryBtn} onPress={() => query.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const restaurant = query.data;
  const categories = restaurant.menu ?? [];
  const selectedCat = activeCategory ?? categories[0]?.id;
  const currentItems = categories.find((c) => c.id === selectedCat)?.items ?? [];

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((ci) => ci.item.id === item.id);
      if (existing) return prev.map((ci) => ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
      return [...prev, { item, quantity: 1 }];
    });
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const existing = prev.find((ci) => ci.item.id === itemId);
      if (!existing) return prev;
      if (existing.quantity === 1) return prev.filter((ci) => ci.item.id !== itemId);
      return prev.map((ci) => ci.item.id === itemId ? { ...ci, quantity: ci.quantity - 1 } : ci);
    });
  }

  const cartTotal = cart.reduce((sum, ci) => sum + ci.item.price_kobo * ci.quantity, 0);
  const cartCount = cart.reduce((sum, ci) => sum + ci.quantity, 0);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroPlaceholder}>
          <Ionicons name="restaurant" size={48} color="rgba(255,255,255,0.4)" />
        </View>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={colors.neutral.white} />
        </Pressable>
        <View style={styles.heroOverlay}>
          <Text style={styles.heroName}>{restaurant.name}</Text>
          <View style={styles.heroMeta}>
            <View style={styles.metaPill}>
              <Ionicons name="star" size={12} color="#F39C12" />
              <Text style={styles.metaText}>{restaurant.rating?.toFixed(1)} ({restaurant.review_count})</Text>
            </View>
            <View style={styles.metaPill}>
              <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.8)" />
              <Text style={styles.metaText}>{restaurant.delivery_time_min} min</Text>
            </View>
            <View style={[styles.metaPill, { backgroundColor: restaurant.is_open ? '#00B89440' : '#dc262640' }]}>
              <Text style={[styles.metaText, { color: restaurant.is_open ? '#00B894' : '#dc2626' }]}>
                {restaurant.is_open ? 'Open' : 'Closed'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Category Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catContent}>
        {categories.map((cat) => (
          <Pressable
            key={cat.id}
            style={[styles.catTab, selectedCat === cat.id && styles.catTabActive]}
            onPress={() => setActiveCategory(cat.id)}
          >
            <Text style={[styles.catTabText, selectedCat === cat.id && styles.catTabTextActive]}>
              {cat.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Menu Items */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.menuList}>
        {currentItems.map((item) => {
          const inCart = cart.find((ci) => ci.item.id === item.id);
          return (
            <View key={item.id} style={styles.menuItem}>
              <View style={styles.menuItemImage}>
                <Ionicons name="fast-food" size={28} color={colors.neutral.placeholder} />
              </View>
              <View style={styles.menuItemBody}>
                <Text style={styles.menuItemName}>{item.name}</Text>
                <Text style={styles.menuItemDesc} numberOfLines={2}>{item.description}</Text>
                <Text style={styles.menuItemPrice}>{formatCurrency(item.price_kobo, 'NGN')}</Text>
              </View>
              <View style={styles.menuItemControls}>
                {inCart ? (
                  <View style={styles.qtyControls}>
                    <Pressable style={styles.qtyBtn} onPress={() => removeFromCart(item.id)}>
                      <Ionicons name="remove" size={16} color={colors.primary.DEFAULT} />
                    </Pressable>
                    <Text style={styles.qtyText}>{inCart.quantity}</Text>
                    <Pressable style={styles.qtyBtn} onPress={() => addToCart(item)}>
                      <Ionicons name="add" size={16} color={colors.primary.DEFAULT} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={[styles.addBtn, !item.available && styles.addBtnDisabled]}
                    onPress={() => item.available && addToCart(item)}
                  >
                    <Ionicons name="add" size={18} color={colors.neutral.white} />
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Cart Bar */}
      {cartCount > 0 && (
        <View style={styles.cartBar}>
          <View style={styles.cartBadge}>
            <Text style={styles.cartBadgeText}>{cartCount}</Text>
          </View>
          <Text style={styles.cartBarText}>View Order</Text>
          <Text style={styles.cartBarTotal}>{formatCurrency(cartTotal, 'NGN')}</Text>
          <Pressable
            style={styles.cartBarBtn}
            onPress={() =>
              router.push({
                pathname: '/restaurant/checkout',
                params: {
                  restaurantId: id,
                  cartJson: JSON.stringify(cart),
                },
              } as never)
            }
          >
            <Ionicons name="arrow-forward" size={20} color={colors.neutral.white} />
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 15, color: colors.neutral.textMuted },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary.DEFAULT, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  hero: { height: 220, backgroundColor: colors.primary.dark, position: 'relative' },
  heroPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  backBtn: {
    position: 'absolute',
    top: 14,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
  },
  heroName: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  heroMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  metaText: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '500' },
  catScroll: { maxHeight: 52, flexGrow: 0, backgroundColor: colors.neutral.surface },
  catContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  catTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  catTabActive: { borderBottomColor: colors.primary.DEFAULT },
  catTabText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '500' },
  catTabTextActive: { color: colors.primary.DEFAULT, fontWeight: '700' },
  menuList: { padding: 16, gap: 12, paddingBottom: 100 },
  menuItem: {
    flexDirection: 'row',
    backgroundColor: colors.neutral.surface,
    borderRadius: 14,
    overflow: 'hidden',
    padding: 12,
    gap: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  menuItemImage: {
    width: 70,
    height: 70,
    borderRadius: 10,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemBody: { flex: 1 },
  menuItemName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  menuItemDesc: { fontSize: 12, color: colors.neutral.textMuted, marginVertical: 3 },
  menuItemPrice: { fontSize: 14, fontWeight: '700', color: colors.primary.DEFAULT },
  menuItemControls: { alignItems: 'center', justifyContent: 'center' },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: colors.neutral.placeholder },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  qtyText: { fontSize: 14, fontWeight: '700', color: colors.neutral.text, minWidth: 16, textAlign: 'center' },
  cartBar: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    shadowColor: colors.primary.DEFAULT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  cartBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cartBarText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  cartBarTotal: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cartBarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
