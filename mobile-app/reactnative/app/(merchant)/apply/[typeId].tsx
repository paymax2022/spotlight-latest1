import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { WizardProgress } from '@/features/doctor/components';
import { DynamicField } from '@/features/merchant/components';
import { useOnboardingDraft } from '@/features/merchant/store/onboardingDraftStore';
import {
  useMerchantType,
  useFormSchema,
  useCreateApplication,
  useSaveDraft,
  useSubmitApplication,
} from '@/features/merchant/hooks/useMerchant';
import { isFieldVisible, validateStep } from '@/features/merchant/api/merchant.api';
import type { FieldErrors } from '@/types/merchant';

// Screen: Dynamic onboarding wizard (PRD §6.2, FR-8 … FR-13).
// Builds steps/fields from the merchant type's versioned JSON schema, supports
// draft/resume, conditional visibility, per-step validation, and submit.
export default function OnboardingWizardScreen() {
  const { typeId } = useLocalSearchParams<{ typeId: string }>();
  const { data: type, isLoading: typeLoading, isError: typeError } = useMerchantType(typeId);
  const { data: schema, isLoading: schemaLoading } = useFormSchema(type?.currentFormSchemaId);

  const create = useCreateApplication();
  const saveDraft = useSaveDraft();
  const submit = useSubmitApplication();

  const { applicationId, data, stepIndex, hydrate, setField, setStep, reset } = useOnboardingDraft();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [duplicate, setDuplicate] = useState(false);
  const [createError, setCreateError] = useState(false);

  // Create (or resume) the application once the type is known.
  useEffect(() => {
    if (!typeId || create.isPending || applicationId) return;
    reset();
    create.mutate(
      { merchantTypeId: typeId },
      {
        onSuccess: (app) => hydrate(app.id, app.data),
        onError: (e: unknown) => {
          if (e instanceof Error && e.message === 'DUPLICATE_PROFILE') setDuplicate(true);
          else setCreateError(true);
        },
      },
    );
  }, [typeId, applicationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = schema?.steps ?? [];
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;
  const visibleFields = useMemo(() => step?.fields.filter((f) => isFieldVisible(f, data)) ?? [], [step, data]);

  const goNext = () => {
    if (!step) return;
    const result = validateStep(step, data);
    if (!result.ok) { setErrors(result.errors); return; }
    setErrors({});
    if (isLastStep) { handleSubmit(); return; }
    setStep(stepIndex + 1);
  };

  const goBack = () => {
    if (stepIndex === 0) { router.back(); return; }
    setErrors({});
    setStep(stepIndex - 1);
  };

  const handleSaveExit = async () => {
    if (!applicationId) { router.back(); return; }
    try { await saveDraft.mutateAsync({ applicationId, data }); } catch { /* keep local */ }
    reset();
    router.dismissAll?.();
    router.replace('/(merchant)');
  };

  const handleSubmit = async () => {
    if (!applicationId) return;
    try {
      const app = await submit.mutateAsync({ applicationId, data });
      reset();
      router.replace(`/(merchant)/application/${app.id}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'VALIDATION_FAILED') {
        setErrors({ _form: 'Some required fields are missing. Please review each step.' });
      } else {
        setErrors({ _form: 'Submission failed. Please try again.' });
      }
    }
  };

  // ── States ──────────────────────────────────────────────────────────────────
  if (duplicate) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={type?.name ?? 'Apply'} />
        <StateView
          kind="empty" icon="BadgeCheck"
          title="You already provide this"
          message="You hold an active profile for this provider type. Manage it from your capabilities."
          actionLabel="Go to capabilities"
          onAction={() => router.replace('/(merchant)')}
        />
      </SafeAreaView>
    );
  }

  if (typeError || createError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Apply" />
        <StateView kind="error" title="Couldn't start your application" message="Please try again." actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (typeLoading || schemaLoading || create.isPending || !schema || !step) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={type?.name ?? 'Apply'} />
        <StateView kind="loading" message="Preparing your application" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={type?.name ?? 'Apply'}
        subtitle={`${type?.moduleName} · v${schema.version}`}
        onBack={goBack}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.progressWrap}>
            <WizardProgress current={stepIndex + 1} total={steps.length} label={step.title} />
          </View>

          <Text style={styles.stepTitle}>{step.title}</Text>
          {!!step.description && <Text style={styles.stepDesc}>{step.description}</Text>}

          <View style={styles.fields}>
            {visibleFields.map((field) => (
              <DynamicField
                key={field.key}
                field={field}
                value={data[field.key] ?? null}
                error={errors[field.key]}
                onChange={(v) => { setField(field.key, v); if (errors[field.key]) setErrors((e) => ({ ...e, [field.key]: '' })); }}
              />
            ))}
          </View>

          {!!errors._form && <Text style={styles.formError}>{errors._form}</Text>}

          <PrimaryButton
            label={isLastStep ? 'Submit application' : 'Continue'}
            onPress={goNext}
            loading={submit.isPending}
            style={styles.primaryBtn}
          />
          <PrimaryButton
            label="Save & finish later"
            variant="ghost"
            onPress={handleSaveExit}
            loading={saveDraft.isPending}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  progressWrap:{ marginBottom: Spacing.sm },
  stepTitle:   { ...Typography.headlineMd, color: Colors.onSurface },
  stepDesc:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: Spacing.md },
  fields:      { marginTop: Spacing.md },
  formError:   { ...Typography.labelMd, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  primaryBtn:  { marginTop: Spacing.sm, marginBottom: Spacing.sm },
});
