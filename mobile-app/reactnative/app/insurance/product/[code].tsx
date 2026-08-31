// ── Protection — product detail ──────────────────────────────────────────────
// A real plan from the live catalog: what it costs (flat naira or a rate on the
// value you declare), who underwrites it, how long it runs, what it covers, how
// it works and how to claim — the last four arriving as provider HTML, rendered
// as readable blocks rather than raw markup.
//
// It also carries the PLAN PICKER. Insurers sell several tiers of one thing as
// separate products (FlexiCare, FlexiCare Mini, PrimeCare, Seniors and ZenCare
// are all Bastion health), and someone shopping for health cover wants to
// compare those side by side — not meet them as five unrelated rows in a list.
// Choosing a tier belongs here, before the form, not buried inside it.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { BadgeCheck, CalendarDays, Check, RefreshCw, ShieldCheck, Wallet } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  DetailSkeleton,
  HtmlContent,
  HtmlSection,
  InsuranceErrorState,
  PriceLabel,
  PricingModeBadge,
  UnderwriterRow,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { categoryMeta } from '@/features/insurance/live/catalog';
import { familyPlans } from '@/features/insurance/live/formEngine';
import { toBulletList } from '@/features/insurance/live/html';
import { useLiveProduct, useLiveProducts } from '@/features/insurance/live/hooks';
import { coverPeriodLabel, nairaCompact, priceDisplay } from '@/features/insurance/live/money';
import type { Product } from '@/features/insurance/live/types';

export default function ProductDetail() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const product = useLiveProduct(code ?? '');
  // The full catalog is already cached from browse; it is what lets us find the
  // sibling plans that share this product's purchase form.
  const catalog = useLiveProducts();

  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const plans = useMemo(
    () => familyPlans(product.data, catalog.data),
    [product.data, catalog.data],
  );
  const selected: Product | undefined =
    plans.find((p) => p.code === selectedCode) ?? product.data ?? undefined;

  if (product.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cover" />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (product.isError || !product.data || !selected) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cover" />
        <InsuranceErrorState error={product.error} onRetry={() => product.refetch()} />
      </SafeAreaView>
    );
  }

  const meta = categoryMeta(selected.productLine);
  const Icon =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? ShieldCheck;
  const price = priceDisplay(selected);
  const highlights = toBulletList(selected.keyBenefitsHtml, 5);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={meta.label} subtitle={selected.underwriter || undefined} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Icon size={26} color={InsuranceColors.brand} strokeWidth={2} />
          </View>
          <Text style={styles.title}>{selected.name}</Text>
          {selected.description ? (
            <Text style={styles.desc}>{selected.description}</Text>
          ) : null}
        </View>

        {/* Price — flat and percentage read very differently on purpose. */}
        <View style={styles.priceCard}>
          <View style={styles.priceRow}>
            <PriceLabel product={selected} size="lg" />
            <View style={styles.grow} />
            <PricingModeBadge product={selected} />
          </View>
          <Text style={styles.priceNote}>
            {price.kind === 'percentage'
              ? 'Your premium is worked out from the value you declare, and confirmed by the insurer before you pay.'
              : 'A fixed premium for the full cover period. The exact amount is confirmed before you pay.'}
          </Text>
        </View>

        <UnderwriterRow
          underwriter={selected.underwriter}
          logoUrl={selected.underwriterLogoUrl}
          aggregator={selected.aggregator === 'mycover' ? 'MyCover.ai' : selected.aggregator}
        />

        {/* Plan picker — only when the family really has more than one plan. */}
        {plans.length > 1 ? (
          <View style={styles.planBlock}>
            <Text style={styles.sectionTitle}>Choose your plan</Text>
            <Text style={styles.sectionSub}>
              {plans.length} tiers from {selected.underwriter}. Prices and cover differ.
            </Text>
            <View style={styles.planList}>
              {plans.map((plan) => (
                <PlanRow
                  key={plan.code}
                  plan={plan}
                  selected={plan.code === selected.code}
                  onPress={() => setSelectedCode(plan.code)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Key facts */}
        <View style={styles.factGrid}>
          <Fact
            icon={<CalendarDays size={16} color={InsuranceColors.brand} />}
            label="Cover period"
            value={coverPeriodLabel(selected.coverPeriodDays)}
          />
          <Fact
            icon={<Wallet size={16} color={InsuranceColors.brand} />}
            label="Cover up to"
            value={selected.sumInsuredKobo > 0 ? nairaCompact(selected.sumInsuredKobo) : 'You declare'}
          />
          <Fact
            icon={<RefreshCw size={16} color={InsuranceColors.brand} />}
            label="Renewal"
            value={selected.isRenewable ? 'Renewable' : 'One-off'}
          />
          <Fact
            icon={<BadgeCheck size={16} color={InsuranceColors.brand} />}
            label="Certificate"
            value={selected.isCertificateable ? 'Issued' : 'Not issued'}
          />
        </View>

        {/* Headline benefits, pulled out of the provider's HTML. */}
        {highlights.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What's covered</Text>
            {highlights.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={styles.bulletIcon}>
                  <Check size={13} color={InsuranceColors.ok} strokeWidth={2.8} />
                </View>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What's covered</Text>
            <HtmlContent
              html={selected.fullBenefitsHtml}
              collapseAfter={4}
              emptyText="The insurer hasn't published a benefit summary for this plan yet. The full policy wording is issued with your certificate."
            />
          </View>
        )}

        <HtmlSection title="Full benefits" html={selected.fullBenefitsHtml} />
        <HtmlSection title="How it works" html={selected.howItWorksHtml} />
        <HtmlSection
          title="How to claim"
          html={selected.howToClaimHtml}
          emptyText={
            selected.isClaimable
              ? 'Claims for this plan are filed in the app and passed to the insurer.'
              : 'This plan is not claimable in-app — the insurer handles claims directly.'
          }
        />

        <Text style={styles.disclaimer}>
          Cover is provided by {selected.underwriter || 'the insurer named on your certificate'},
          a NAICOM-licensed insurer. Paymax distributes this policy and does not carry the risk.
        </Text>
      </ScrollView>

      {/* A plan the insurer cannot currently sell gets an honest closed state
          rather than a button that walks a person through a full application
          and refuses them at pricing. */}
      {selected.purchasable ? (
        <View style={styles.footer}>
          <View style={styles.footerPrice}>
            {/* PriceLabel already prints "from" for a rate-priced plan, so the
                label above it must not repeat the word. */}
            <Text style={styles.footerLabel}>
              {price.kind === 'percentage' ? 'Your rate' : 'Premium'}
            </Text>
            <PriceLabel product={selected} />
          </View>
          <View style={styles.grow}>
            <PrimaryButton
              label="Get covered"
              onPress={() =>
                router.push(`/insurance/quote/form?code=${encodeURIComponent(selected.code)}`)
              }
            />
          </View>
        </View>
      ) : (
        <View style={styles.footerClosed}>
          <Text style={styles.closedTitle}>Not available right now</Text>
          <Text style={styles.closedText}>
            {selected.underwriter || 'The insurer'} has this plan listed but isn&apos;t issuing it
            at the moment. Nothing you did — try another plan in {meta.label.toLowerCase()}.
          </Text>
          <PrimaryButton
            label={`See other ${meta.label.toLowerCase()} plans`}
            variant="secondary"
            onPress={() => router.replace(`/insurance/browse?line=${selected.productLine}`)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

/** One selectable plan within a family. */
function PlanRow({
  plan,
  selected,
  onPress,
}: {
  plan: Product;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.planRow, selected && styles.planRowActive]}
    >
      <View style={[styles.radio, selected && styles.radioActive]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.grow}>
        <Text style={styles.planName} numberOfLines={2}>
          {plan.name}
        </Text>
        <Text style={styles.planMeta} numberOfLines={1}>
          {coverPeriodLabel(plan.coverPeriodDays)}
          {plan.sumInsuredKobo > 0 ? ` · up to ${nairaCompact(plan.sumInsuredKobo)}` : ''}
        </Text>
      </View>
      <PriceLabel product={plan} size="sm" />
    </Pressable>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      {icon}
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  grow: { flex: 1 },
  scroll: {
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: 32,
    gap: Spacing.md,
  },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingTop: Spacing.sm },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: Radius.lg,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },

  priceCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  priceNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },

  planBlock: { gap: Spacing.xs },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  planList: { gap: Spacing.sm, marginTop: Spacing.sm },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: InsuranceColors.surface,
  },
  planRowActive: { borderColor: InsuranceColors.brand, backgroundColor: Colors.iconBgPurple },
  radio: {
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    borderWidth: 2,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: InsuranceColors.brand },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    backgroundColor: InsuranceColors.brand,
  },
  planName: { ...Typography.labelLg, color: Colors.onSurface },
  planMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },

  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  fact: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: 2,
  },
  factLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  factValue: { ...Typography.labelLg, color: Colors.onSurface },

  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  bulletIcon: {
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    backgroundColor: InsuranceColors.okBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  bulletText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 23 },

  disclaimer: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    lineHeight: 18,
    marginTop: Spacing.xs,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
  footerPrice: { minWidth: 96 },
  footerLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footerClosed: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
    gap: Spacing.sm,
  },
  closedTitle: { ...Typography.titleMd, color: Colors.onSurface },
  closedText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
});
