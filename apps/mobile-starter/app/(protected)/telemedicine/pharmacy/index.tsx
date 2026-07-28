// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { listPharmacyProducts, addToCart } from '@/api/telemedicine.api';
import { generateIdempotencyKey } from '@/utils/idempotency';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  secondaryContainer: '#e0f2fe',
  tertiary: '#F59E0B',
  tertiaryContainer: '#fef3c7',
  purple: '#8B5CF6',
  purpleContainer: '#ede9fe',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
};

const CATEGORIES = [
  { id: 'all', label: 'All', icon: 'apps-outline' },
  { id: 'pain', label: 'Pain Relief', icon: 'bandage-outline' },
  { id: 'vitamins', label: 'Vitamins', icon: 'leaf-outline' },
  { id: 'first_aid', label: 'First Aid', icon: 'medkit-outline' },
  { id: 'baby', label: 'Baby Care', icon: 'happy-outline' },
  { id: 'skincare', label: 'Skincare', icon: 'color-palette-outline' },
  { id: 'devices', label: 'Devices', icon: 'hardware-chip-outline' },
];

const FEATURED_PRODUCTS = [
  { id: 'p1', name: 'Paracetamol 500mg', category: 'pain', price_kobo: 1250_00, unit: '20 tabs', is_bestseller: true, is_essential: false, in_stock: true },
  { id: 'p2', name: 'Multivitamin Complex', category: 'vitamins', price_kobo: 2400_00, unit: '30 caps', is_bestseller: false, is_essential: false, in_stock: true },
  { id: 'p3', name: 'Emergency Kit Pro', category: 'first_aid', price_kobo: 4500_00, unit: '1 kit', is_bestseller: false, is_essential: true, in_stock: true },
  { id: 'p4', name: 'Allergy Relief Spray', category: 'skincare', price_kobo: 1875_00, unit: '50ml', is_bestseller: false, is_essential: false, in_stock: true },
];

export default function PharmacyHome() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [cartCount, setCartCount] = useState(3);

  const { data: products, isLoading } = useQuery({
    queryKey: ['pharmacy-products', activeCategory, search],
    queryFn: () => listPharmacyProducts({ category: activeCategory !== 'all' ? activeCategory : undefined, search: search || undefined }),
  });

  const addCartMutation = useMutation({
    mutationFn: (productId: string) => addToCart({ product_id: productId, quantity: 1 }),
    onSuccess: () => setCartCount((c) => c + 1),
  });

  const displayProducts = (products && products.length > 0) ? products : FEATURED_PRODUCTS;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>Paymax Pharmacy</Text>
        <Pressable style={s.cartBtn}>
          <Ionicons name="cart-outline" size={24} color={C.text} />
          {cartCount > 0 && (
            <View style={s.cartBadge}><Text style={s.cartBadgeText}>{cartCount}</Text></View>
          )}
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Promo banner */}
        <View style={s.promoBanner}>
          <View style={s.promoLeft}>
            <View style={s.promoDiscountBadge}>
              <Text style={s.promoDiscountText}>20% OFF</Text>
            </View>
            <Text style={s.promoTitle}>First Order Discount</Text>
            <Text style={s.promoSub}>Fast, safe delivery. HMO verified.</Text>
          </View>
          <Pressable style={s.promoCta}>
            <Text style={s.promoCtaText}>Claim Now</Text>
          </Pressable>
        </View>

        {/* Services row */}
        <View style={s.servicesRow}>
          <Pressable style={s.serviceCard}>
            <View style={[s.serviceIcon, { backgroundColor: C.primaryContainer }]}>
              <Ionicons name="document-text-outline" size={22} color={C.primary} />
            </View>
            <Text style={s.serviceName}>Upload Prescription</Text>
            <Text style={s.serviceDesc}>Instant pharmacist review</Text>
          </Pressable>
          <Pressable style={s.serviceCard}>
            <View style={[s.serviceIcon, { backgroundColor: C.secondaryContainer }]}>
              <Ionicons name="shield-checkmark-outline" size={22} color={C.secondary} />
            </View>
            <Text style={s.serviceName}>HMO Coverage</Text>
            <Text style={s.serviceDesc}>Check discounted rates</Text>
          </Pressable>
          <Pressable style={s.serviceCard}>
            <View style={[s.serviceIcon, { backgroundColor: C.tertiaryContainer }]}>
              <Ionicons name="card-outline" size={22} color={C.tertiary} />
            </View>
            <Text style={s.serviceName}>Link Insurance</Text>
            <Text style={s.serviceDesc}>Connect your plan</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={s.searchRow}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search medicines & products…"
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Category chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoriesScroll}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat.id}
              style={[s.categoryChip, activeCategory === cat.id && s.categoryChipActive]}
              onPress={() => setActiveCategory(cat.id)}
            >
              <Ionicons name={cat.icon as any} size={14} color={activeCategory === cat.id ? '#fff' : C.textMuted} />
              <Text style={[s.categoryLabel, activeCategory === cat.id && { color: '#fff' }]}>{cat.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Featured products */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Featured Products</Text>
          <Pressable><Text style={s.viewAll}>See All</Text></Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginVertical: 20 }} />
        ) : (
          <View style={s.productsGrid}>
            {displayProducts.map((product) => (
              <View key={product.id} style={s.productCard}>
                {/* Product image placeholder */}
                <View style={s.productImage}>
                  <Ionicons name="medkit" size={32} color={C.primary} />
                  {product.is_bestseller && (
                    <View style={s.bestsellerBadge}>
                      <Text style={s.bestsellerText}>Best Seller</Text>
                    </View>
                  )}
                  {product.is_essential && (
                    <View style={[s.bestsellerBadge, { backgroundColor: C.tertiary }]}>
                      <Text style={s.bestsellerText}>Essential</Text>
                    </View>
                  )}
                </View>
                <View style={s.productBody}>
                  <Text style={s.productCategory}>{product.category.replace('_', ' ')}</Text>
                  <Text style={s.productName} numberOfLines={2}>{product.name}</Text>
                  <Text style={s.productUnit}>{product.unit}</Text>
                  <View style={s.productFooter}>
                    <Text style={s.productPrice}>₦{((product.price_kobo ?? 0) / 100).toLocaleString()}</Text>
                    <Pressable
                      style={s.addBtn}
                      onPress={() => addCartMutation.mutate(product.id)}
                    >
                      <Ionicons name="add" size={18} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* HMO banner */}
        <View style={s.hmoBanner}>
          <Ionicons name="shield-checkmark" size={20} color={C.primary} />
          <Text style={s.hmoBannerText}>Present your HMO card at checkout for up to 40% discount</Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: C.text },
  cartBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  cartBadge: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
  cartBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  promoBanner: { margin: 16, backgroundColor: C.primaryDark, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  promoLeft: {},
  promoDiscountBadge: { backgroundColor: C.tertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, alignSelf: 'flex-start', marginBottom: 8 },
  promoDiscountText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  promoTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  promoSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 3 },
  promoCta: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  promoCtaText: { color: C.primaryDark, fontWeight: '700', fontSize: 13 },
  servicesRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 },
  serviceCard: { flex: 1, backgroundColor: C.surface, borderRadius: 14, padding: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  serviceIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  serviceName: { fontSize: 12, fontWeight: '700', color: C.text, textAlign: 'center' },
  serviceDesc: { fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 44, marginBottom: 14 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text },
  categoriesScroll: { paddingHorizontal: 16, gap: 8, marginBottom: 16, paddingBottom: 4 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, backgroundColor: C.surfaceVariant, borderWidth: 1, borderColor: C.border },
  categoryChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  categoryLabel: { fontSize: 12, color: C.textMuted, fontWeight: '500' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  viewAll: { fontSize: 13, color: C.primary, fontWeight: '600' },
  productsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12 },
  productCard: { width: '47%', backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  productImage: { height: 100, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  bestsellerBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: C.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  bestsellerText: { fontSize: 9, color: '#fff', fontWeight: '700' },
  productBody: { padding: 10 },
  productCategory: { fontSize: 10, color: C.primary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  productName: { fontSize: 13, fontWeight: '700', color: C.text, lineHeight: 18 },
  productUnit: { fontSize: 11, color: C.textMuted, marginTop: 2, marginBottom: 8 },
  productFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  productPrice: { fontSize: 14, fontWeight: '800', color: C.text },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  hmoBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 16, backgroundColor: C.primaryContainer, borderRadius: 14, padding: 14 },
  hmoBannerText: { flex: 1, fontSize: 13, color: C.primaryDark, fontWeight: '500', lineHeight: 18 },
});
