import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useProfileDraft, usePublishProfile } from '@/features/doctor/hooks';

export default function ProfilePublishedScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const publish = usePublishProfile();
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string>();

  const isLive = published || !!draft?.isPublished;

  const handlePublish = async () => {
    if (!draft) return;
    setError(undefined);
    try {
      await publish.mutateAsync({ draftId: draft.id });
      setPublished(true);
    } catch {
      setError('Could not publish your profile. Please try again.');
    }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Publish profile" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Publish profile" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const p = draft.personalInfo;
  const fullName = `${p.title} ${p.firstName} ${p.lastName}`.trim();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Publish profile" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Sparkles size={36} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>{isLive ? 'Your profile is live' : 'Publish your profile'}</Text>
          <Text style={styles.heroSub}>
            {isLive
              ? 'Patients can now find and book consultations with you.'
              : 'Make your verified profile discoverable so patients can book you.'}
          </Text>
        </View>

        <SectionCard title="Profile" style={styles.card}>
          <InfoRow label="Name" value={fullName} />
          <InfoRow label="Status" value={isLive ? 'Published' : 'Verified · not published'} valueColor={isLive ? Colors.teal : Colors.secondary} />
        </SectionCard>

        {!!error && <Text style={styles.error}>{error}</Text>}

        {isLive ? (
          <>
            <PrimaryButton label="Go to dashboard" onPress={() => router.replace('/(doctor)/(tabs)')} style={styles.btn} />
            <PrimaryButton label="Preview public profile" onPress={() => router.push('/(doctor)/profile/setup/preview')} variant="secondary" style={styles.btnGap} />
          </>
        ) : (
          <PrimaryButton label="Publish now" onPress={handlePublish} loading={publish.isPending} style={styles.btn} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  heroIcon:  { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:      { marginBottom: Spacing.md },
  error:     { ...Typography.labelMd, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  btn:       { marginTop: Spacing.sm },
  btnGap:    { marginTop: Spacing.sm },
});
