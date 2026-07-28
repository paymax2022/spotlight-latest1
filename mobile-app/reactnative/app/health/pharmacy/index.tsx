import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Upload,
  ChevronRight,
  Pill,
  ScrollText,
  RefreshCw,
  ShoppingCart,
  ClipboardList,
  MessageCircle,
  ShieldCheck,
  HeartPulse,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import PharmacyProductCard from '@/features/health/components/PharmacyProductCard';
import { useProducts, usePrescriptions } from '@/features/health/pharmacy/hooks';
import { useCartStore } from '@/features/health/pharmacy/cartStore';
import { formatNaira } from '@/features/health/constants/health.constants';
import { PHARMACY_SYMPTOM_SEARCH_ENABLED } from '@/features/health/api/symptomSearch.api';

const QUICK_ACTIONS = [
  { key: 'upload', label: 'Upload Rx', icon: Upload, href: '/health/pharmacy/upload-rx', bg: Colors.iconBgBlue, color: Colors.secondary },
  { key: 'refills', label: 'Refills', icon: RefreshCw, href: '/health/pharmacy/refills', bg: Colors.iconBgTeal, color: Colors.teal },
  { key: 'meds', label: 'My meds', icon: ClipboardList, href: '/health/pharmacy/medication-list', bg: Colors.iconBgPurple, color: Colors.primary },
  { key: 'orders', label: 'Orders', icon: ScrollText, href: '/health/pharmacy/orders', bg: Colors.iconBgGold, color: Colors.onWarning },
] as const;

export default function PharmacyHomeScreen() {
  const { data: products, isLoading, isError, refetch } = useProducts();
  const { data: prescriptions } = usePrescriptions();
  const count = useCartStore((s) => s.count());

  const verifyingRx = (prescriptions ?? []).find((r) => r.status === 'verifying');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Pharmacy"
        subtitle="Order meds & upload prescriptions"
        rightSlot={
          <Pressable onPress={() => router.push('/health/pharmacy/cart')} hitSlop={8} accessibilityLabel="Cart">
            <ShoppingCart size={22} color={Colors.primary} strokeWidth={2} />
            {count > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{count}</Text>
              </View>
            ) : null}
          </Pressable>
        }
      />

      <SearchBar
        placeholder="Search medicines, brands, or pharmacy…"
        editable={false}
        onPress={() => router.push('/health/pharmacy/search')}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Symptom-based search entry (addon PRD Journey A) — flag-gated */}
        {PHARMACY_SYMPTOM_SEARCH_ENABLED ? (
          <Pressable style={[styles.symptomEntry, shadow1]} onPress={() => router.push('/health/pharmacy/symptom')}>
            <View style={[styles.consultIcon, { backgroundColor: Colors.iconBgTeal }]}>
              <HeartPulse size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.consultTitle}>What are you feeling?</Text>
              <Text style={styles.consultSub}>Tell us your symptoms — see safe options, not a diagnosis</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        ) : null}

        {/* Upload Rx hero (HL-3) */}
        <Pressable style={[styles.hero, shadow1]} onPress={() => router.push('/health/pharmacy/upload-rx')}>
          <View style={styles.heroIcon}>
            <Upload size={22} color={Colors.onPrimary} strokeWidth={2} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>Upload your prescription</Text>
            <Text style={styles.heroSub}>A licensed pharmacist verifies it before dispensing.</Text>
          </View>
          <ChevronRight size={20} color={Colors.onPrimary} strokeWidth={2} />
        </Pressable>

        {/* Verifying Rx banner */}
        {verifyingRx ? (
          <Pressable
            style={[styles.rxBanner, shadow1]}
            onPress={() => router.push({ pathname: '/health/pharmacy/rx-status', params: { id: verifyingRx.id } })}
          >
            <ScrollText size={18} color={Colors.onWarning} strokeWidth={2} />
            <Text style={styles.rxBannerText}>A prescription is being verified — tap to track</Text>
            <ChevronRight size={16} color={Colors.onWarning} strokeWidth={2} />
          </Pressable>
        ) : null}

        {/* Quick actions */}
        <View style={styles.actionsRow}>
          {QUICK_ACTIONS.map((a) => (
            <Pressable key={a.key} style={styles.action} onPress={() => router.push(a.href as never)}>
              <View style={[styles.actionIcon, { backgroundColor: a.bg }]}>
                <a.icon size={20} color={a.color} strokeWidth={2} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Pharmacist consult */}
        <Pressable style={[styles.consult, shadow1]} onPress={() => router.push('/health/pharmacy/pharmacist-consult')}>
          <View style={[styles.consultIcon, { backgroundColor: Colors.iconBgBlue }]}>
            <MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.consultTitle}>Ask a pharmacist</Text>
            <Text style={styles.consultSub}>Free chat about dosage, interactions & more</Text>
          </View>
          <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
        </Pressable>

        {/* Popular products */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Popular medicines</Text>
          <Pressable onPress={() => router.push('/health/pharmacy/search')} hitSlop={8}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <StateView kind="loading" compact message="Loading medicines…" />
        ) : isError ? (
          <StateView kind="error" compact title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
        ) : (products ?? []).length === 0 ? (
          <StateView kind="empty" compact icon="Pill" title="No products" message="Check back soon." />
        ) : (
          <View style={styles.grid}>
            {(products ?? []).slice(0, 6).map((p) => (
              <View key={p.id} style={styles.gridItem}>
                <PharmacyProductCard
                  product={p}
                  onPress={() => router.push({ pathname: '/health/pharmacy/product/[id]', params: { id: p.id } })}
                />
              </View>
            ))}
          </View>
        )}

        {/* NDPA / safety strip */}
        <View style={styles.safety}>
          <ShieldCheck size={13} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.safetyText}>
            All listed products are NAFDAC-registered. Prescription medicines need a pharmacist-verified Rx.
          </Text>
        </View>

        {count > 0 ? (
          <Pressable style={[styles.cartCta, shadow1]} onPress={() => router.push('/health/pharmacy/cart')}>
            <ShoppingCart size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.cartCtaText}>View cart · {count} item{count > 1 ? 's' : ''}</Text>
            <Text style={styles.cartCtaAmount}>{formatNaira(useCartStore.getState().cart().subtotalKobo)}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 110, gap: Spacing.lg },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { ...Typography.caption, color: Colors.onSecondary, fontWeight: '700' as const, fontSize: 10 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.md,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: { flex: 1 },
  heroTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.onPrimary },
  heroSub: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  rxBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    padding: Spacing.sm + 4,
  },
  rxBannerText: { ...Typography.labelMd, color: Colors.onWarning, flex: 1 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { alignItems: 'center', gap: 6, width: '23%' },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface },
  symptomEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: Colors.teal,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  consult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  consultIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  consultTitle: { ...Typography.labelLg, color: Colors.onSurface },
  consultSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface },
  link: { ...Typography.labelMd, color: Colors.secondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridItem: { width: '48%' },
  safety: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 8,
  },
  safetyText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 15 },
  cartCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  cartCtaText: { ...Typography.labelLg, color: Colors.onPrimary, flex: 1 },
  cartCtaAmount: { ...Typography.labelLg, color: Colors.onPrimary },
});
