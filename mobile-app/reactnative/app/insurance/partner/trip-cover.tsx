import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Navigation } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useTripCoverStatus } from '@/features/insurance/partner';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import CoverBadge from '@/features/insurance/components/cover-CoverBadge';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

/** Partner/driver: trip/job cover status (PRD §13 / §15.3). */
export default function PartnerTripCover() {
  const trip = useTripCoverStatus();

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Trip cover" />
        <StateView kind="loading" message="Checking cover…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || !trip.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Trip cover" />
        <StateView kind="error" title="Couldn't load cover" actionLabel="Retry" onAction={() => trip.refetch()} />
      </SafeAreaView>
    );
  }

  const t = trip.data;

  if (!t.hasActiveJob) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Trip cover" />
        <StateView kind="empty" title="No active trip" message="Start a trip or job to see live cover here." icon="Navigation" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Trip cover" subtitle={t.jobLabel} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Navigation size={26} color={InsuranceColors.octamile} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>{t.covered ? "You're covered" : 'No cover on this trip'}</Text>
          <Text style={styles.heroSub}>{t.jobLabel}{t.startedAt ? ` · started ${new Date(t.startedAt).toLocaleTimeString('en-NG', { timeStyle: 'short' } as any)}` : ''}</Text>
          <View style={{ marginTop: Spacing.xs }}>
            <CoverBadge status={t.covered ? 'INSURED' : 'UNCOVERED'} underwriter={t.disclosure?.underwriter} />
          </View>
        </View>

        {t.covered && t.disclosure ? <UnderwriterBadge disclosure={t.disclosure} /> : null}

        {t.covered ? (
          <View style={styles.card}>
            <PremiumRow label="Cover" value={t.productName ?? '—'} />
            {t.sumInsuredKobo != null ? <PremiumRow label="Sum insured" amountKobo={t.sumInsuredKobo} emphasis /> : null}
          </View>
        ) : null}

        <Text style={styles.note}>
          {t.covered
            ? 'Per-trip protection binds automatically when a trip starts. If an incident happens, file a claim against this trip.'
            : 'This trip has no active cover. Complete onboarding consent to enable per-trip protection.'}
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {t.covered ? (
          <PrimaryButton label="File a claim for this trip" onPress={() => router.push('/insurance/partner/file-claim')} />
        ) : (
          <PrimaryButton label="Enable cover" onPress={() => router.push('/insurance/partner/onboarding-consent')} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: InsuranceColors.octamileBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
