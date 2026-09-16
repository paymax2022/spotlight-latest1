import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { IntakeField } from '@/features/health/components';
import { useIntakeSchema, useIntakeDraft, useSaveIntakeDraft, useSubmitIntake } from '@/features/health/hooks';
import { validateIntake } from '@/features/health/utils';
import { alertAsync } from '@/lib/confirm';
import type { IntakeErrors, IntakeResponseValues, IntakeValue } from '@/features/health/types';

/**
 * Schema-driven questionnaire RENDERER — one renderer drives N schemas. Reused by
 * pharmacy/lab/vet for triage, symptom and test-prep forms. Persists a draft as
 * the user types and maps server/local field errors back to each field.
 */
export default function IntakeRendererScreen() {
  const { schemaId, subjectId } = useLocalSearchParams<{ schemaId: string; subjectId?: string }>();
  const { data: schema, isLoading, isError, refetch } = useIntakeSchema(schemaId);
  const { data: draft } = useIntakeDraft(schemaId, subjectId);
  const saveDraft = useSaveIntakeDraft();
  const submit = useSubmitIntake();

  const [values, setValues] = useState<IntakeResponseValues>({});
  const [errors, setErrors] = useState<IntakeErrors>({});
  const hydrated = useRef(false);

  // Rehydrate from a saved draft once.
  useEffect(() => {
    if (draft && !hydrated.current) {
      setValues(draft.values);
      hydrated.current = true;
    }
  }, [draft]);

  const setValue = (fieldId: string, value: IntakeValue) => {
    setValues((prev) => {
      const next = { ...prev, [fieldId]: value };
      // Persist draft (debounce not required for mock; throttle in live build).
      if (schema) {
        saveDraft.mutate({ schemaId: schema.id, schemaVersion: schema.version, values: next, subjectId });
      }
      return next;
    });
    // Clear the field's error as the user edits.
    setErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const { [fieldId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const onSubmit = () => {
    if (!schema) return;
    const found = validateIntake(schema, values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      alertAsync({ title: 'Please review', message: 'Some required answers are missing or invalid.' });
      return;
    }
    submit.mutate(
      { schemaId: schema.id, schemaVersion: schema.version, values, subjectId },
      {
        onSuccess: () => {
          alertAsync({ title: 'Submitted', message: 'Your responses were sent to your provider.', buttonLabel: 'Done' }).then(() => goBack('/health'));
        },
        onError: () => alertAsync({ title: 'Could not submit', message: 'Please try again.' }),
      },
    );
  };

  const errorCount = useMemo(() => Object.keys(errors).length, [errors]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={schema?.title ?? 'Intake form'} subtitle={schema ? `v${schema.version}` : undefined} />

      {isLoading ? (
        <StateView kind="loading" message="Loading form…" />
      ) : isError || !schema ? (
        <StateView kind="error" title="Form unavailable" message="This intake form could not be loaded." actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.intro}>{schema.description}</Text>

            {draft && hydrated.current ? (
              <View style={styles.draftBadge}>
                <Check size={13} color={Colors.teal} strokeWidth={2.4} />
                <Text style={styles.draftText}>Draft restored — your progress is saved automatically</Text>
              </View>
            ) : null}

            {errorCount > 0 ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>
                  {errorCount} {errorCount === 1 ? 'field needs' : 'fields need'} attention
                </Text>
              </View>
            ) : null}

            {schema.sections.map((section) => (
              <View key={section.id} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.description ? <Text style={styles.sectionDesc}>{section.description}</Text> : null}
                {section.fields.map((field) => (
                  <IntakeField
                    key={field.id}
                    field={field}
                    value={values[field.id] ?? null}
                    error={errors[field.id]}
                    onChange={(v) => setValue(field.id, v)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton label="Submit responses" onPress={onSubmit} loading={submit.isPending} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  draftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 7,
  },
  draftText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1 },
  errorBanner: { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.sm + 2 },
  errorBannerText: { ...Typography.labelMd, color: Colors.error },
  section: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  sectionTitle: { ...Typography.titleMd, fontSize: 17, color: Colors.onSurface, marginBottom: Spacing.xs },
  sectionDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
