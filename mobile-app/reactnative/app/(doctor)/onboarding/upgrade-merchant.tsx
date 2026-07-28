import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Store, BadgeCheck, Wallet, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useMerchantUpgradeStatus, useRequestMerchantUpgrade } from '@/features/doctor/hooks';
import type { MerchantUpgradeState } from '@/types/doctor.onboarding';

// ── Section A · Entry 3 — Upgrade user profile to Merchant (provider) ─────────
// Reads useMerchantUpgradeStatus; requestMerchantUpgrade kicks off the upgrade.
// Once the upgrade is requested / type chosen, routes on to provider-type.

const STATE_LABEL: Record<MerchantUpgradeState, string> = {
  not_started:   'Not started',
  type_selected: 'Type selected',
  in_progress:   'In progress',
  submitted:     'Submitted',
  completed:     'Completed',
};

const STATE_TONE: Record<MerchantUpgradeState, StatusTone> = {
  not_started:   'neutral',
  type_selected: 'info',
  in_progress:   'info',
  submitted:     'warning',
  completed:     'success',
};

const BENEFITS = [
  { icon: Wallet, label: 'Earn from consultations', sub: 'Accept paid bookings and receive payouts to your bank.' },
  { icon: Users,  label: 'Reach more patients',     sub: 'Get discovered by patients looking for your specialty.' },
  { icon: BadgeCheck, label: 'Verified provider badge', sub: 'Build trust with a verified practitioner profile.' },
];

export default function UpgradeMerchantScreen() {
  const { data: status, isLoading, isError, refetch } = useMerchantUpgradeStatus();
  const requestUpgrade = useRequestMerchantUpgrade();
  const [error, setError] = useState<string>();

  const handleUpgrade = async () => {
    setError(undefined);
    try {
      await requestUpgrade.mutateAsync(undefined);
      router.push('/(doctor)/onboarding/provider-type');
    } catch {
      setError('Could not start the upgrade. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Become a provider" />

      {isLoading && !status ? (
        <StateView variant="loading" label="Loading" />
      ) : isError || !status ? (
        <StateView variant="error" message="We could not load your upgrade status." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Store size={28} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.introTitle}>Upgrade to a provider account</Text>
            <Text style={styles.introSub}>Turn your account into a verified practice so you can take consultations and get paid.</Text>
          </View>

          <SectionCard title="What you get" style={styles.card}>
            {BENEFITS.map((b, i) => {
              const Icon = b.icon;
              return (
                <View key={b.label} style={[styles.benefit, i > 0 && styles.benefitBorder]}>
                  <View style={styles.benefitIcon}>
                    <Icon size={20} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.benefitBody}>
                    <Text style={styles.benefitLabel}>{b.label}</Text>
                    <Text style={styles.benefitSub}>{b.sub}</Text>
                  </View>
                </View>
              );
            })}
          </SectionCard>

          <SectionCard title="Upgrade status" style={styles.card}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Status</Text>
              <StatusBadge label={STATE_LABEL[status.state]} tone={STATE_TONE[status.state]} />
            </View>
            {!!status.selectedType && <InfoRow label="Chosen type" value={status.selectedType} />}
            <InfoRow label="Updated" value={new Date(status.updatedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} />
          </SectionCard>

          {!!error && <Text style={styles.error}>{error}</Text>}

          {status.state === 'not_started' ? (
            <PrimaryButton label="Start upgrade" onPress={handleUpgrade} loading={requestUpgrade.isPending} style={styles.btn} />
          ) : (
            <PrimaryButton label="Continue — choose provider type" onPress={() => router.push('/(doctor)/onboarding/provider-type')} style={styles.btn} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:         { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:     { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle:    { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  introSub:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:          { marginBottom: Spacing.md },
  benefit:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  benefitBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  benefitIcon:   { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  benefitBody:   { flex: 1, gap: 2 },
  benefitLabel:  { ...Typography.labelLg, color: Colors.onSurface },
  benefitSub:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  statusRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  statusLabel:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  error:         { ...Typography.labelMd, color: Colors.error, marginBottom: Spacing.sm, textAlign: 'center' },
  btn:           { marginTop: Spacing.sm },
});
