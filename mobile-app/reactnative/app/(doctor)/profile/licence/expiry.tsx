import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, AlertTriangle, ShieldX } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useLicenceExpiryWarning } from '@/features/doctor/hooks';
import type { LicenceStatus } from '@/types/doctor.profile';

const STATUS_META: Record<LicenceStatus, { icon: LucideIcon; color: string; bg: string; tone: StatusTone; label: string }> = {
  valid:         { icon: ShieldCheck,   color: Colors.teal,      bg: Colors.iconBgTeal,     tone: 'success', label: 'Valid' },
  expiring_soon: { icon: AlertTriangle, color: Colors.secondary, bg: Colors.iconBgBlue,     tone: 'warning', label: 'Expiring soon' },
  expired:       { icon: ShieldX,       color: Colors.error,     bg: Colors.errorContainer, tone: 'danger',  label: 'Expired' },
  suspended:     { icon: ShieldX,       color: Colors.error,     bg: Colors.errorContainer, tone: 'danger',  label: 'Suspended' },
};

export default function LicenceExpiryScreen() {
  const { data: warning, isLoading, isError, refetch } = useLicenceExpiryWarning();

  if (isLoading && !warning) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Licence status" />
        <StateView variant="loading" label="Checking your licence" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Licence status" />
        <StateView variant="error" message="We could not load your licence status." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  if (!warning) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Licence status" />
        <StateView variant="empty" icon={ShieldCheck} title="No warnings" message="Your licence is valid. We will alert you before it expires." />
      </SafeAreaView>
    );
  }

  const meta = STATUS_META[warning.status];
  const Icon = meta.icon;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Licence status" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: meta.bg }]}>
            <Icon size={36} color={meta.color} strokeWidth={2} />
          </View>
          <StatusBadge label={meta.label} tone={meta.tone} />
          <Text style={styles.heroSub}>{warning.message}</Text>
        </View>

        <SectionCard title="Licence details" style={styles.card}>
          <InfoRow label="Licence number" value={warning.licenceNumber} />
          <InfoRow label="Expires" value={new Date(warning.expiresAt + 'T00:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
          <InfoRow label="Days to expiry" value={warning.daysToExpiry >= 0 ? `${warning.daysToExpiry} days` : `Expired ${Math.abs(warning.daysToExpiry)} days ago`} valueColor={warning.daysToExpiry < 0 ? Colors.error : undefined} />
        </SectionCard>

        <PrimaryButton label="Renew licence" onPress={() => router.push('/(doctor)/profile/licence/renew')} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:      { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  heroIcon:  { width: 80, height: 80, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:      { marginBottom: Spacing.md },
  btn:       { marginTop: Spacing.sm },
});
