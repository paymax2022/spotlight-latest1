import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, ChevronRight, Eye, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useProfileDraft } from '@/features/doctor/hooks';
import { PROFILE_BUILDER_STEPS } from '@/features/doctor/constants';
import type { ProfileBuilderStep } from '@/types/doctor.profile';

// Maps each builder step to the route it deep-links to. Availability (19) is the
// existing standalone screen; everything else lives under profile/setup.
const STEP_ROUTE: Record<ProfileBuilderStep, string> = {
  personal_info:   '/(doctor)/profile/setup/personal',
  profile_photo:   '/(doctor)/profile/setup/photo',
  bio:             '/(doctor)/profile/setup/bio',
  specialty:       '/(doctor)/profile/setup/specialty',
  sub_specialty:   '/(doctor)/profile/setup/sub-specialty',
  experience:      '/(doctor)/profile/setup/experience',
  languages:       '/(doctor)/profile/setup/languages',
  licence_number:  '/(doctor)/profile/setup/licence-number',
  licence_upload:  '/(doctor)/profile/setup/licence-upload',
  government_id:   '/(doctor)/profile/setup/government-id',
  certificates:    '/(doctor)/profile/setup/certificates',
  association:     '/(doctor)/profile/setup/association',
  affiliations:    '/(doctor)/profile/setup/affiliations',
  education:       '/(doctor)/profile/setup/education',
  work_experience: '/(doctor)/profile/setup/work-experience',
  pricing:         '/(doctor)/profile/setup/pricing',
  free_follow_up:  '/(doctor)/profile/setup/free-follow-up',
  availability:    '/(doctor)/availability',
  bank_account:    '/(doctor)/profile/setup/bank-account',
  tax_info:        '/(doctor)/profile/setup/tax-info',
};

export default function ProfileSetupHubScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Create profile" />
        <StateView variant="loading" label="Loading your profile" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Create profile" />
        <StateView variant="error" message="We could not load your profile draft." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const done = new Set(draft.completedSteps);
  const completedCount = PROFILE_BUILDER_STEPS.filter((s) => done.has(s.step)).length;
  const total = PROFILE_BUILDER_STEPS.length;
  const allDone = completedCount === total;
  const firstIncomplete = PROFILE_BUILDER_STEPS.find((s) => !done.has(s.step));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Create profile" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <ShieldCheck size={24} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.introTitle}>Complete your doctor profile</Text>
          <Text style={styles.introSub}>Finish each step to submit your profile for verification and start accepting consultations.</Text>
        </View>

        <WizardProgress current={completedCount} total={total} label={`${completedCount}/${total} complete`} />

        <SectionCard title="Profile steps" style={styles.card}>
          {PROFILE_BUILDER_STEPS.map((s, i) => {
            const isDone = done.has(s.step);
            return (
              <Pressable
                key={s.step}
                onPress={() => router.push(STEP_ROUTE[s.step] as never)}
                style={[styles.stepRow, i > 0 && styles.stepBorder]}
                accessibilityRole="button"
                accessibilityLabel={s.label}
              >
                <View style={[styles.stepCheck, isDone && styles.stepCheckOn]}>
                  {isDone ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : <Text style={styles.stepNum}>{s.screen - 1}</Text>}
                </View>
                <Text style={styles.stepLabel} numberOfLines={1}>{s.label}</Text>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          })}
        </SectionCard>

        <Pressable style={styles.previewLink} onPress={() => router.push('/(doctor)/profile/setup/preview')} accessibilityRole="button" accessibilityLabel="Preview profile">
          <Eye size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.previewText}>Preview profile</Text>
        </Pressable>

        {allDone ? (
          <PrimaryButton label="Review & submit" onPress={() => router.push('/(doctor)/profile/setup/preview')} style={styles.btn} />
        ) : (
          <PrimaryButton
            label={firstIncomplete ? `Continue: ${firstIncomplete.label}` : 'Continue'}
            onPress={() => firstIncomplete && router.push(STEP_ROUTE[firstIncomplete.step] as never)}
            style={styles.btn}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:       { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:   { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle:  { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  introSub:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:        { marginBottom: Spacing.md },
  stepRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  stepBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  stepCheck:   { width: 28, height: 28, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  stepCheckOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stepNum:     { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700' },
  stepLabel:   { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  previewLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  previewText: { ...Typography.labelMd, color: Colors.secondary },
  btn:         { marginTop: Spacing.xs },
});
