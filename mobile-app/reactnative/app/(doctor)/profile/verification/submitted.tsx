// PRIVACY: Assisted Mode B verification. This screen shows the doctor only a
// coarse "in review" status and their own submission details. It must NEVER
// render MDCN/register data, reviewer identity, internal reviewer notes, or
// matched-field detail — Paymax verifies out-of-band and the doctor never sees
// the MDCN portal.
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useVerification } from '@/features/doctor/hooks';

export default function VerificationSubmittedScreen() {
  const { data: submission, isLoading, isError, refetch } = useVerification();

  if (isLoading && !submission) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Submitted" />
        <StateView variant="loading" label="Confirming submission" />
      </SafeAreaView>
    );
  }

  if (isError || !submission) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Submitted" />
        <StateView variant="error" message="We could not confirm your submission." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Submitted" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <CheckCircle2 size={36} color={Colors.teal} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>Profile submitted</Text>
          <Text style={styles.heroSub}>Thanks! Your profile is now in the verification queue.</Text>
        </View>

        <SectionCard title="Submission details" style={styles.card}>
          {submission.submittedAt && <InfoRow label="Submitted" value={new Date(submission.submittedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />}
          <InfoRow label="Documents" value={`${submission.documents.length} uploaded`} />
          <InfoRow label="Status" value="In review" valueColor={Colors.secondary} />
        </SectionCard>

        <View style={styles.next}>
          <Clock size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.nextText}>Verification usually takes 24–48 hours. We will notify you of the outcome.</Text>
        </View>

        <View style={styles.next}>
          <ShieldCheck size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.nextText}>You do not need to visit the MDCN portal or any external site — Paymax handles verification for you.</Text>
        </View>

        <PrimaryButton label="Track status" onPress={() => router.replace('/(doctor)/signup/pending')} style={styles.btn} />
        <PrimaryButton label="Go to dashboard" onPress={() => router.replace('/(doctor)/(tabs)')} variant="secondary" style={styles.btnGap} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  heroIcon:  { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  heroSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:      { marginBottom: Spacing.md },
  next:      { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgBlue, marginBottom: Spacing.md },
  nextText:  { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  btn:       { marginTop: Spacing.sm },
  btnGap:    { marginTop: Spacing.sm },
});
