import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, User } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useCustomer, useRecommendedProducts } from '@/features/insurance/agent';
import { UnderwriterBadge } from '@/features/insurance/components';
import { InsuranceColors, formatNaira, TIER_LABEL, CADENCE_SUFFIX } from '@/features/insurance/constants/insurance.constants';
import type { InsuranceProduct } from '@/features/insurance/types';

/** Agent: recommend a product for the selected customer (PRD §15.2). */
export default function AgentRecommend() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const customer = useCustomer(customerId ?? '');
  const products = useRecommendedProducts();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Recommend cover" subtitle={customer.data?.fullName ?? 'Customer'} />

      {customer.isLoading || products.isLoading ? (
        <StateView kind="loading" message="Loading recommendations…" />
      ) : customer.isError || products.isError || !customer.data ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => { customer.refetch(); products.refetch(); }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          <View style={styles.customerCard}>
            <View style={styles.avatar}><User size={20} color={InsuranceColors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{customer.data.fullName}</Text>
              <Text style={styles.meta}>Wallet {formatNaira(customer.data.walletKobo)} · {TIER_LABEL[customer.data.kycTier]}</Text>
            </View>
          </View>

          <Text style={styles.section}>Recommended for this customer</Text>
          {(products.data ?? []).map((p) => (
            <ProductRow
              key={p.code}
              product={p}
              onPress={() => router.push(`/insurance/agent/assisted-quote?customerId=${customerId}&code=${encodeURIComponent(p.code)}`)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProductRow({ product, onPress }: { product: InsuranceProduct; onPress: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[product.icon] ?? Icons.ShieldCheck;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={styles.iconBox}><Icon size={20} color={InsuranceColors.brand} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{product.displayName}</Text>
          <Text style={styles.sub} numberOfLines={1}>{product.shortDescription}</Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.from}>From {formatNaira(product.fromPremiumKobo)}{CADENCE_SUFFIX[product.premiumCadence] ?? ''}</Text>
      </View>
      <UnderwriterBadge disclosure={product.disclosure} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 48, gap: Spacing.md },
  customerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: InsuranceColors.surfaceAlt, borderRadius: Radius.lg, padding: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  from: { ...Typography.labelLg, color: InsuranceColors.brand },
});
