import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ChevronLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import FieldRenderer from '@/features/registration/components/FieldRenderer';
import WizardProgress from '@/features/registration/components/WizardProgress';
import { useDraft, useSaveStep, useUploadFile } from '@/features/registration/hooks/useRegistration';
import { isLockedForEditing } from '@/features/registration/utils/status';
import { withCityOptions, dependentCityKey } from '@/features/registration/utils/cityOptions';
import { validateRequiredFields } from '@/features/registration/lib/validation';
import type { RegistrationStep } from '@/features/registration/types/registration.types';

export default function RegistrationWizardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = id ?? '';

  const draftQuery = useDraft(appId);
  const saveStep = useSaveStep(appId);
  const uploadFile = useUploadFile();

  const [stepIndex, setStepIndex] = React.useState(0);
  // Local edits for the active step; merged into the draft on Save/Next.
  const [edits, setEdits] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const draft = draftQuery.data?.draft;
  const steps: RegistrationStep[] = draftQuery.data?.steps ?? [];
  const step = steps[stepIndex];

  // Reset transient edit state whenever we move to a different step.
  React.useEffect(() => {
    setEdits({});
    setErrors({});
  }, [stepIndex]);

  const valueFor = (key: string) => (key in edits ? edits[key] : draft?.formData?.[key]);
  const onChange = (key: string, value: unknown) => {
    setEdits((prev) => {
      const next = { ...prev, [key]: value };
      // Changing a state clears its dependent city so a stale city from the
      // previous state can't linger (the city options are recomputed below).
      const cityKey = dependentCityKey(key);
      if (cityKey) next[cityKey] = '';
      return next;
    });
    setErrors((prev) => (prev[key] ? { ...prev, [key]: '' } : prev));
  };

  const runUpload = async (file: { uri: string; name: string; mimeType: string }) => uploadFile.mutateAsync(file);

  if (draftQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Registration" />
        <StateView kind="loading" message="Loading your application…" />
      </SafeAreaView>
    );
  }

  if (draftQuery.isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Registration" />
        <StateView kind="error" title="Couldn’t load application" message="Please try again." actionLabel="Retry" onAction={() => draftQuery.refetch()} />
      </SafeAreaView>
    );
  }

  // Already submitted / closed → send the user to the status screen instead.
  if (isLockedForEditing(draft.status)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Registration" />
        <StateView
          kind="empty"
          icon="LockKeyhole"
          title="This application is locked"
          message="It has already been submitted and can no longer be edited. View its status to track progress."
          actionLabel="View status"
          onAction={() => router.replace(`/registration/${appId}/status` as never)}
        />
      </SafeAreaView>
    );
  }

  if (steps.length === 0 || !step) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Registration" />
        <StateView kind="empty" title="Nothing to fill in" message="This application has no steps to complete." />
      </SafeAreaView>
    );
  }

  const isLastStep = stepIndex === steps.length - 1;

  const handleNext = () => {
    // Client-side validation: check required fields are filled
    const validationErrors = validateRequiredFields(step, draft?.formData ?? {}, edits);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    // All required fields are filled, send to backend
    saveStep.mutate(
      { stepKey: step.key, values: edits },
      {
        onSuccess: (res) => {
          if (!res.validation.isValid) {
            setErrors(res.validation.errors);
            return;
          }
          setErrors({});
          if (isLastStep) {
            router.push(`/registration/${appId}/submit` as never);
          } else {
            setStepIndex((i) => Math.min(i + 1, steps.length - 1));
          }
        },
      },
    );
  };

  const handleBack = () => {
    if (stepIndex === 0) {
      goBack('/registration');
    } else {
      setStepIndex((i) => Math.max(0, i - 1));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={draft.reference} subtitle="Registration" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <WizardProgress stepIndex={stepIndex} stepCount={steps.length} title={step.title} description={step.description} />

        <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {saveStep.isError && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>We couldn’t save this step. Please try again.</Text>
            </View>
          )}
          {Object.keys(errors).length > 0 && (
            <View style={[styles.banner, styles.bannerWarn]}>
              <Text style={styles.bannerText}>Please complete the highlighted required fields.</Text>
            </View>
          )}

          {step.fields
            .filter((field) => {
              // Exclude payment and ID fields
              const excludedFields = [
                'payment.method',
                'payment.transactionReference',
                'id.cardType',
                'id.number',
                'personal.idCardType',
                'personal.idNumber',
              ];
              return !excludedFields.includes(field.key);
            })
            .map((field) => (
              <FieldRenderer
                key={field.key}
                field={withCityOptions(field, valueFor)}
                value={valueFor(field.key)}
                error={errors[field.key]}
                onChange={onChange}
                onUpload={runUpload}
              />
            ))}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.backBtn} onPress={handleBack} hitSlop={6}>
            <ChevronLeft size={20} color={Colors.onSurface} />
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
          <View style={styles.nextWrap}>
            <PrimaryButton
              label={isLastStep ? 'Review' : 'Save & continue'}
              onPress={handleNext}
              loading={saveStep.isPending}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  form: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  banner: { backgroundColor: Colors.errorContainer, borderRadius: 12, padding: Spacing.md, marginBottom: Spacing.md },
  bannerWarn: { backgroundColor: Colors.iconBgGold },
  bannerText: { ...Typography.labelMd, color: Colors.onSurface },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, paddingRight: Spacing.sm },
  backLabel: { ...Typography.labelLg, color: Colors.onSurface },
  nextWrap: { flex: 1 },
});
