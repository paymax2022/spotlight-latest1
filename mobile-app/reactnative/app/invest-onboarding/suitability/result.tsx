import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import RiskResultCard from '@/features/investonboarding/components/RiskResultCard';
import { useSuitability } from '@/features/investonboarding/hooks/useOnboarding';
import { NO_ADVICE_NOTE } from '@/features/investonboarding/constants/onboarding.constants';
import { resetSuitabilityDraft } from '@/features/investonboarding/utils/onboardingDraft';

export default function SuitabilityResultScreen() {
  const { data, isLoading, isError, refetch } = useSuitability();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your profile" showBack={false} />
        <StateView kind="loading" message="Scoring your answers…" />
      </SafeAreaView>
    );
  }
  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your profile" />
        <StateView
          kind="empty"
          icon="ClipboardList"
          title="No profile yet"
          message="Take the quick questionnaire so we can suggest suitable products."
          actionLabel="Start questionnaire"
          onAction={() => { resetSuitabilityDraft(); router.replace('/invest-onboarding/suitability/questions'); }}
        />
        {isError ? <PrimaryButton label="Retry" variant="ghost" onPress={() => refetch()} /> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your profile" showBack={false} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <RiskResultCard result={data} />
        <Text style={styles.note}>{NO_ADVICE_NOTE}</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue to agreements" onPress={() => router.replace('/invest-onboarding/agreements')} />
        <View style={{ height: Spacing.sm }} />
        <PrimaryButton
          label="Retake questionnaire"
          variant="ghost"
          onPress={() => { resetSuitabilityDraft(); router.replace('/invest-onboarding/suitability/questions'); }}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
