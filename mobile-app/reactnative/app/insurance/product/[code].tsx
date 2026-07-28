import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check, X, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useProduct } from '@/features/insurance/hooks';
import { UnderwriterBadge, PremiumRow, DisclosureSheet } from '@/features/insurance/components';
import {
  InsuranceColors,
  formatNaira,
  PRODUCT_LINE_LABEL,
  TIER_LABEL,
} from '@/features/insurance/constants/insurance.constants';

export default function ProductDetail() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const product = useProduct(code ?? '');
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  if (product.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Product" />
        <StateView kind="loading" message="Loading product…" />
      </SafeAreaView>
    );
  }
  if (product.isError || !product.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Product" />
        <StateView
          kind="error"
          title="Couldn't load product"
          message="This product may be unavailable."
          actionLabel="Retry"
          onAction={() => product.refetch()}
        />
      </SafeAreaView>
    );
  }

  const p = product.data;
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[p.icon] ?? ShieldCheck;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={PRODUCT_LINE_LABEL[p.productLine] ?? 'Product'} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Icon size={28} color={InsuranceColors.brand} strokeWidth={2} /></View>
          <Text style={styles.title}>{p.displayName}</Text>
          <Text style={styles.desc}>{p.shortDescription}</Text>
        </View>

        {/* Disclosure (PRD §5) */}
        <UnderwriterBadge disclosure={p.disclosure} onPress={() => setDisclosureOpen(true)} />

        {/* Key facts */}
        <View style={styles.card}>
          <PremiumRow label="From" amountKobo={p.fromPremiumKobo} cadence={p.premiumCadence} />
          <PremiumRow label="Cover up to" amountKobo={p.sumInsuredRules.max} />
          <PremiumRow label="Required KYC" value={TIER_LABEL[p.requiredKycTier]} />
        </View>

        {/* Benefits */}
        <Text style={styles.sectionTitle}>What's covered</Text>
        <View style={styles.card}>
          {p.benefits.map((b) => (
            <View key={b} style={styles.bulletRow}>
              <View style={[styles.bulletIcon, styles.bulletOk]}><Check size={14} color={InsuranceColors.ok} strokeWidth={2.6} /></View>
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Exclusions */}
        <Text style={styles.sectionTitle}>What's not covered</Text>
        <View style={styles.card}>
          {p.exclusions.map((e) => (
            <View key={e} style={styles.bulletRow}>
              <View style={[styles.bulletIcon, styles.bulletNo]}><X size={14} color={Colors.error} strokeWidth={2.6} /></View>
              <Text style={styles.bulletText}>{e}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Get a quote"
          onPress={() => router.push(`/insurance/quote/form?code=${encodeURIComponent(p.code)}`)}
        />
      </View>

      <DisclosureSheet visible={disclosureOpen} disclosure={p.disclosure} onClose={() => setDisclosureOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.sm },
  bulletIcon: { width: 22, height: 22, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  bulletOk: { backgroundColor: InsuranceColors.okBg },
  bulletNo: { backgroundColor: Colors.errorContainer },
  bulletText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
