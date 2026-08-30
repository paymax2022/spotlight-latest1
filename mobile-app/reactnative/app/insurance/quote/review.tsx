import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, ScrollText, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useQuote } from '@/features/insurance/hooks';
import { UnderwriterBadge, PremiumRow, DisclosureSheet } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

export default function QuoteReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const quote = useQuote(id ?? '');
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  if (quote.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your quote" />
        <StateView kind="loading" message="Fetching your quote…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your quote" />
        <StateView
          kind="error"
          title="Quote unavailable"
          message="Your quote may have expired. Start a new one."
          actionLabel="Start over"
          onAction={() => router.replace('/insurance/browse')}
        />
      </SafeAreaView>
    );
  }

  const q = quote.data;
  const expires = new Date(q.expiresAt);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your quote" subtitle={q.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Premium hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Premium</Text>
          <Text style={styles.heroAmount}>
            {(q.premiumKobo / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 })}
          </Text>
          <View style={styles.ttlRow}>
            <Clock size={13} color={InsuranceColors.muted} />
            <Text style={styles.ttl}>Valid until {expires.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
        </View>

        {/* Disclosure (PRD §5) */}
        <UnderwriterBadge disclosure={q.disclosure} onPress={() => setDisclosureOpen(true)} />

        {/* Quote breakdown */}
        <View style={styles.card}>
          <PremiumRow label="Cover (sum insured)" amountKobo={q.sumInsuredKobo} />
          <PremiumRow label="Premium" amountKobo={q.premiumKobo} cadence={q.premiumCadence} emphasis />
        </View>

        {/* Terms link */}
        <Pressable style={styles.linkRow} onPress={() => router.push(`/insurance/quote/terms?id=${q.id}`)}>
          <ScrollText size={20} color={Colors.onSurfaceVariant} />
          <Text style={styles.linkText}>Terms, benefits & exclusions</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>

        <Text style={styles.disclaimer}>
          By continuing you'll be asked to consent to sharing the data this product requires with the
          provider (NDPA 2023). Premium is debited from your wallet and passed through to the underwriter.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Continue to consent"
          onPress={() => router.push(`/insurance/consent?id=${q.id}`)}
        />
      </View>

      <DisclosureSheet visible={disclosureOpen} disclosure={q.disclosure} onClose={() => setDisclosureOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.xs },
  heroLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  heroAmount: { ...Typography.displayLg, color: InsuranceColors.brand, fontSize: 40, letterSpacing: -0.8, lineHeight: 48 },
  ttlRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ttl: { ...Typography.labelSm, color: InsuranceColors.muted },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border,
    padding: Spacing.md,
  },
  linkText: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  disclaimer: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
