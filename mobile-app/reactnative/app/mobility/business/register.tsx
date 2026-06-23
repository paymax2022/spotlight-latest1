import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useCreateBusinessAccount } from '@/features/mobility/hooks/useLogistics';
import { LOGISTICS_ENABLED } from '@/features/mobility/constants/modes.constants';
import type { BusinessAccountType, BillingMode } from '@/features/mobility/types/logistics.types';

const ACCOUNT_TYPES: { value: BusinessAccountType; label: string; hint: string }[] = [
  { value: 'sme',        label: 'SME',        hint: 'Small business' },
  { value: 'merchant',   label: 'Merchant',   hint: 'Retail / e-commerce' },
  { value: 'enterprise', label: 'Enterprise', hint: 'High-volume operations' },
];

const BILLING_MODES: { value: BillingMode; label: string; hint: string }[] = [
  { value: 'prepaid', label: 'Prepaid wallet', hint: 'Fund a wallet, escrow per delivery' },
  { value: 'invoice', label: 'Monthly invoice', hint: 'Accrue now, settle at period close' },
];

export default function RegisterBusinessScreen() {
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<BusinessAccountType>('sme');
  const [billingMode, setBillingMode] = useState<BillingMode>('prepaid');
  const [codEnabled, setCodEnabled] = useState(false);

  const create = useCreateBusinessAccount();

  if (!LOGISTICS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Register business" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const canSubmit = name.trim().length > 1 && !create.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    create.mutate(
      { name: name.trim(), accountType, billingMode, codEnabled },
      { onSuccess: () => router.replace('/mobility/business') },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Register business" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Building2 size={24} color={Colors.primary} strokeWidth={2.2} /></View>
          <Text style={styles.heroTitle}>Set up your account</Text>
          <Text style={styles.heroSub}>Tell us about your business to start sending tracked deliveries.</Text>
        </View>

        <Text style={styles.section}>Business name</Text>
        <TextInputField value={name} onChangeText={setName} placeholder="e.g. Eze Supplies Ltd" />

        <Text style={styles.section}>Account type</Text>
        <View style={styles.list}>
          {ACCOUNT_TYPES.map((t) => (
            <SelectableCard key={t.value} title={t.label} subtitle={t.hint} selected={accountType === t.value} onPress={() => setAccountType(t.value)} />
          ))}
        </View>

        <Text style={styles.section}>Billing</Text>
        <View style={styles.list}>
          {BILLING_MODES.map((m) => (
            <SelectableCard key={m.value} title={m.label} subtitle={m.hint} selected={billingMode === m.value} onPress={() => setBillingMode(m.value)} />
          ))}
        </View>

        <Pressable style={styles.codRow} onPress={() => setCodEnabled((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: codEnabled }}>
          <View style={[styles.checkbox, codEnabled && styles.checkboxOn]}>{codEnabled && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.codTitle}>Enable cash on delivery (COD)</Text>
            <Text style={styles.codHint}>Couriers collect cash from receivers on your behalf.</Text>
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Create account" onPress={onSubmit} loading={create.isPending} disabled={!canSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  hero: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 6, marginBottom: Spacing.sm },
  heroIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleMd, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md, marginBottom: Spacing.xs },
  list: { gap: Spacing.sm },
  codRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  codTitle: { ...Typography.labelLg, color: Colors.onSurface },
  codHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
