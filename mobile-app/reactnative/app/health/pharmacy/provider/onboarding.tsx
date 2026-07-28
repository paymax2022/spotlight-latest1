import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Building2, ShieldCheck, CircleCheck, Clock, CircleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import { useProviderOnboarding, useSubmitProviderOnboarding } from '@/features/health/pharmacy/hooks';
import type { ProviderOnboardingState } from '@/features/health/pharmacy/types';

const STATUS_COPY: Record<ProviderOnboardingState['status'], { label: string; message: string; tone: 'info' | 'ok' | 'warn' }> = {
  draft: { label: 'Draft', message: 'Complete your details and submit for review.', tone: 'info' },
  submitted: { label: 'Submitted', message: 'Your application is queued for review.', tone: 'info' },
  under_review: { label: 'Under review', message: 'PCN licence and premises are being verified.', tone: 'info' },
  needs_info: { label: 'More info needed', message: 'Please update the highlighted details and resubmit.', tone: 'warn' },
  approved: { label: 'Approved', message: 'You are verified and discoverable to patients.', tone: 'ok' },
};

export default function ProviderOnboardingScreen() {
  const { data, isLoading, isError, refetch } = useProviderOnboarding();
  const submit = useSubmitProviderOnboarding();

  const [businessName, setBusinessName] = useState('');
  const [pcnLicenseNo, setPcnLicenseNo] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (data) {
      setBusinessName((v) => v || data.businessName || '');
      setPcnLicenseNo((v) => v || data.pcnLicenseNo || '');
    }
  }, [data]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Become a partner" subtitle="PCN & premises verification" />
        <StateView kind="loading" message="Loading your application…" />
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Become a partner" subtitle="PCN & premises verification" />
        <StateView kind="error" title="Couldn't load onboarding" message="Please try again." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Submitted" subtitle="PCN & premises verification" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Submitted for review"
          message="We'll verify your PCN licence and premises. You become discoverable to patients only once approved (HL-2)."
          actionLabel="Back to dashboard"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  const statusMeta = STATUS_COPY[data.status];
  const bannerStyle =
    statusMeta.tone === 'ok' ? styles.bannerOk : statusMeta.tone === 'warn' ? styles.bannerWarn : styles.bannerInfo;
  const bannerText =
    statusMeta.tone === 'ok' ? Colors.teal : statusMeta.tone === 'warn' ? Colors.onWarning : Colors.secondary;
  const BannerIcon = statusMeta.tone === 'ok' ? CircleCheck : statusMeta.tone === 'warn' ? CircleAlert : Clock;

  const onSubmit = async () => {
    await submit.mutateAsync({ businessName, pcnLicenseNo });
    setSubmitted(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Become a partner" subtitle="PCN & premises verification" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Application status banner (HL-2) */}
        <View style={[styles.banner, bannerStyle]}>
          <BannerIcon size={18} color={bannerText} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerLabel, { color: bannerText }]}>{statusMeta.label}</Text>
            <Text style={styles.bannerMsg}>{statusMeta.message}</Text>
          </View>
        </View>

        {/* Business details */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardHead}>
            <View style={[styles.icon, { backgroundColor: Colors.iconBgBlue }]}>
              <Building2 size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <Text style={styles.cardTitle}>Business details</Text>
          </View>
          <TextInputField
            label="Registered business name"
            placeholder="e.g. Wellbeing Community Pharmacy Ltd"
            value={businessName}
            onChangeText={setBusinessName}
            autoCapitalize="words"
          />
        </View>

        {/* PCN licence */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardHead}>
            <View style={[styles.icon, { backgroundColor: Colors.iconBgTeal }]}>
              <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.cardTitle}>PCN licence</Text>
          </View>
          <TextInputField
            label="PCN premises licence number"
            placeholder="e.g. PCN/PR/2024/01234"
            value={pcnLicenseNo}
            onChangeText={setPcnLicenseNo}
            autoCapitalize="characters"
          />
          <CredentialBadge
            credential={{ authority: 'PCN', licenseNo: pcnLicenseNo || '—', status: data.pcnStatus }}
            showLicense
          />
        </View>

        {/* Premises verification */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardHead}>
            <View style={[styles.icon, { backgroundColor: data.premisesVerified ? Colors.iconBgTeal : Colors.iconBgGold }]}>
              {data.premisesVerified ? (
                <CircleCheck size={18} color={Colors.teal} strokeWidth={2} />
              ) : (
                <Clock size={18} color={Colors.onWarning} strokeWidth={2} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Premises verification</Text>
              <Text style={styles.cardSub}>
                {data.premisesVerified ? 'Premises inspected and verified.' : 'Awaiting premises inspection.'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit for review" onPress={onSubmit} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  bannerInfo: { backgroundColor: Colors.iconBgBlue },
  bannerOk: { backgroundColor: Colors.iconBgTeal },
  bannerWarn: { backgroundColor: Colors.iconBgGold },
  bannerLabel: { ...Typography.labelLg, fontWeight: '700' as const },
  bannerMsg: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 1, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
