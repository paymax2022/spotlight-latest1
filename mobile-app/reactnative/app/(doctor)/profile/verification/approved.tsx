import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useVerificationDecision } from '@/features/doctor/hooks';

export default function VerificationApprovedScreen() {
  const { data: decision, isLoading, isError, refetch } = useVerificationDecision();

  if (isLoading && !decision) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Verified" />
        <StateView variant="loading" label="Loading decision" />
      </SafeAreaView>
    );
  }

  if (isError || !decision) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Verified" />
        <StateView variant="error" message="We could not load your verification result." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Verified" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <BadgeCheck size={36} color={Colors.teal} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>You are verified</Text>
          <Text style={styles.heroSub}>Congratulations! Your credentials have been verified. Publish your profile to start accepting consultations.</Text>
        </View>

        <SectionCard title="Decision" style={styles.card}>
          <InfoRow label="Outcome" value="Approved" valueColor={Colors.teal} />
          <InfoRow label="Decided" value={new Date(decision.decidedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />
          {!!decision.reviewer && <InfoRow label="Reviewer" value={decision.reviewer} />}
          {!!decision.notes && <InfoRow label="Notes" value={decision.notes} />}
        </SectionCard>

        <PrimaryButton label="Publish my profile" onPress={() => router.replace('/(doctor)/profile/published')} style={styles.btn} />
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
  btn:       { marginTop: Spacing.sm },
  btnGap:    { marginTop: Spacing.sm },
});
