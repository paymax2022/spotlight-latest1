import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import { PaymentServiceConfig } from '@/data/billPayment';

function DynamicIcon({ name, size = 22, color }: { name: string; size?: number; color: string }) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle;
  return <IconComponent size={size} color={color} strokeWidth={2} />;
}

export default function PaymentScreen({ config }: { config: PaymentServiceConfig }) {
  const [selectedProvider, setSelectedProvider] = useState(config.providers[0]?.id);
  const [selectedAmount, setSelectedAmount] = useState(config.quickAmounts?.[2] ?? config.plans?.[0]?.id ?? '');

  const selectedProviderName = useMemo(
    () => config.providers.find((provider) => provider.id === selectedProvider)?.name ?? config.providers[0]?.name,
    [config.providers, selectedProvider],
  );

  const selectedPlan = useMemo(
    () => config.plans?.find((plan) => plan.id === selectedAmount),
    [config.plans, selectedAmount],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconButton}>
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>{config.title}</Text>
        <Pressable style={styles.iconButton}>
          <Icons.CircleHelp size={21} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LinearGradient
          colors={[config.accent, Colors.primaryContainer]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow2]}
        >
          <View style={styles.heroIcon}>
            <DynamicIcon name={config.icon} color={Colors.onPrimary} size={26} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>Secure bill payment</Text>
            <Text style={styles.heroTitle}>{config.title}</Text>
            <Text style={styles.heroSubtitle}>{config.subtitle}</Text>
          </View>
        </LinearGradient>

        <View style={[styles.card, shadow1]}>
          <Text style={styles.sectionTitle}>{config.providerLabel}</Text>
          <View style={styles.providerGrid}>
            {config.providers.map((provider) => {
              const active = provider.id === selectedProvider;
              return (
                <Pressable
                  key={provider.id}
                  onPress={() => setSelectedProvider(provider.id)}
                  style={[styles.providerCard, active && styles.providerCardActive]}
                >
                  <View style={[styles.providerIcon, { backgroundColor: provider.bg }]}>
                    <Text style={[styles.providerInitial, { color: provider.accent }]}>{provider.name.slice(0, 1)}</Text>
                  </View>
                  <Text style={[styles.providerName, active && styles.providerNameActive]} numberOfLines={1}>{provider.name}</Text>
                  {active && <Icons.CheckCircle2 size={16} color={Colors.primary} strokeWidth={2.2} />}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.formBlock}>
            <TextInputField label={config.accountLabel} placeholder={config.accountPlaceholder} keyboardType="number-pad" />
          </View>

          {config.quickAmounts && (
            <View style={styles.selectorBlock}>
              <Text style={styles.sectionTitle}>{config.amountLabel}</Text>
              <View style={styles.amountGrid}>
                {config.quickAmounts.map((amount) => (
                  <Pressable
                    key={amount}
                    onPress={() => setSelectedAmount(amount)}
                    style={[styles.amountPill, amount === selectedAmount && styles.amountPillActive]}
                  >
                    <Text style={[styles.amountText, amount === selectedAmount && styles.amountTextActive]}>{amount}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInputField label="Custom Amount" placeholder="₦0.00" keyboardType="number-pad" />
            </View>
          )}

          {config.plans && (
            <View style={styles.selectorBlock}>
              <Text style={styles.sectionTitle}>{config.amountLabel}</Text>
              {config.plans.map((plan) => {
                const active = plan.id === selectedAmount;
                return (
                  <Pressable
                    key={plan.id}
                    onPress={() => setSelectedAmount(plan.id)}
                    style={[styles.planRow, active && styles.planRowActive]}
                  >
                    <View>
                      <Text style={[styles.planTitle, active && styles.planTitleActive]}>{plan.label}</Text>
                      {plan.meta && <Text style={styles.planMeta}>{plan.meta}</Text>}
                    </View>
                    <Text style={[styles.planPrice, active && styles.planPriceActive]}>{plan.price}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={[styles.summaryCard, shadow1]}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.sectionTitle}>Payment Summary</Text>
              <Text style={styles.summaryHint}>{config.helperText}</Text>
            </View>
            <View style={styles.secureBadge}>
              <Icons.ShieldCheck size={14} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.secureText}>Secure</Text>
            </View>
          </View>

          <View style={styles.summaryDivider} />
          <SummaryRow label="Provider" value={selectedProviderName} />
          {selectedPlan && <SummaryRow label="Product" value={selectedPlan.label} />}
          {config.summary.map((item) => <SummaryRow key={item.label} label={item.label} value={item.value} />)}
        </View>

        <View style={styles.actionWrap}>
          <PrimaryButton label={config.primaryAction} onPress={() => {}} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(248,249,255,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 120 : 96,
  },
  hero: {
    minHeight: 156,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
    overflow: 'hidden',
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: { flex: 1, gap: Spacing.xs },
  heroEyebrow: { ...Typography.labelSm, color: Colors.inverseOnSurface, opacity: 0.9 },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary },
  heroSubtitle: { ...Typography.bodySm, color: Colors.inverseOnSurface },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.lg,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  providerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  providerCard: {
    width: '48%',
    minHeight: 82,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  providerCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryFixed,
  },
  providerIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerInitial: { ...Typography.labelLg, fontWeight: '800' },
  providerName: { ...Typography.labelMd, color: Colors.onSurface },
  providerNameActive: { color: Colors.onPrimaryFixed },
  formBlock: { marginBottom: Spacing.sm },
  selectorBlock: { marginTop: Spacing.md },
  amountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginVertical: Spacing.md,
  },
  amountPill: {
    minWidth: 94,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  amountPillActive: { backgroundColor: Colors.primaryContainer, borderColor: Colors.primaryContainer },
  amountText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amountTextActive: { color: Colors.onSecondaryContainer },
  planRow: {
    minHeight: 72,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    backgroundColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  planTitle: { ...Typography.labelLg, color: Colors.onSurface },
  planTitleActive: { color: Colors.onPrimaryFixed },
  planMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  planPrice: { ...Typography.labelLg, color: Colors.secondary },
  planPriceActive: { color: Colors.primary },
  summaryCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginBottom: Spacing.lg,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, maxWidth: 220 },
  secureBadge: {
    height: 30,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  secureText: { ...Typography.labelSm, color: Colors.teal },
  summaryDivider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.md },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    gap: Spacing.md,
  },
  summaryLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  actionWrap: { marginBottom: Spacing.lg },
});
