// ── Insurance (live) — the schema-driven purchase form ──────────────────────
// THE central piece of this module.
//
// MyCover exposes one bespoke purchase endpoint per product, each with its own
// required-field schema. There is no shared quote form to hardcode: a medisure
// purchase wants gender + an 11-digit NIN + a photo, a marine-cover purchase
// wants cargo details + a country-of-origin enum + a cargo value ≥ ₦5,000, and
// an office-content purchase wants tenancy, a Nigerian LGA and an item list.
//
// So this renders whatever `FormSchema` it is handed:
//   · chunks the fields into steps (`buildSteps`) so a 12-field motor form is a
//     short sequence rather than one endless scroll — and keeps a small form on
//     a single page, because splitting four fields across three screens is worse
//   · validates each step against the provider's own rules before advancing, so
//     a person is told about the ₦5,000 minimum here rather than by a 400
//   · hides, skips validating, and never submits dependent fields whose
//     controller is unset (`dependsOn`)
//   · takes server-side field errors back and jumps to the step that owns the
//     first one, so a rejection lands under the input that caused it
//
// It holds NO product knowledge whatsoever. Adding a 69th product with a schema
// nobody has seen requires no change here.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { InsuranceColors } from '../../constants/insurance.constants';
import {
  buildSteps,
  firstErroredStep,
  validateAll,
  validateStep,
  visibleFields,
  type FormStep,
} from '../../live/formEngine';
import type { FieldValue, FormSchema, FormValues } from '../../live/types';
import DynamicField from './DynamicField';

export interface DynamicFormHandle {
  values: FormValues;
  step: number;
  totalSteps: number;
}

export default function DynamicForm({
  schema,
  values,
  onChange,
  onSubmit,
  submitLabel = 'Continue',
  submitting = false,
  /** Field errors returned by the server on the last submit attempt. */
  serverFieldErrors,
  /** Rendered above the first step — used for the underwriter disclosure. */
  header,
  /** Rendered under the last step's fields — used for the premium preview. */
  footer,
}: {
  schema: FormSchema | null;
  values: FormValues;
  onChange: (next: FormValues) => void;
  onSubmit: (values: FormValues) => void;
  submitLabel?: string;
  submitting?: boolean;
  serverFieldErrors?: Record<string, string>;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Only show errors for a step the user has actually tried to leave. */
  const [touchedSteps, setTouchedSteps] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<ScrollView>(null);

  // Steps are recomputed from the CURRENT values, because a dependent field can
  // appear or vanish as the user answers — the step list is not static.
  const steps = useMemo(() => buildSteps(schema, values), [schema, values]);
  const total = steps.length;
  const safeIndex = Math.min(stepIndex, Math.max(0, total - 1));
  const step: FormStep | undefined = steps[safeIndex];
  const isLast = safeIndex >= total - 1;

  // A server rejection jumps to the step owning the first errored field, so the
  // message is never shown on a screen the user cannot see the input on.
  useEffect(() => {
    if (!serverFieldErrors || Object.keys(serverFieldErrors).length === 0) return;
    setErrors((prev) => ({ ...prev, ...serverFieldErrors }));
    const target = firstErroredStep(steps, serverFieldErrors);
    if (target >= 0) {
      setStepIndex(target);
      setTouchedSteps((t) => ({ ...t, [steps[target].key]: true }));
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
    // `steps` is derived from values and would re-run this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFieldErrors]);

  if (!schema || total === 0) {
    return (
      <View style={styles.emptySchema}>
        <Text style={styles.emptyTitle}>This product isn't ready to buy yet</Text>
        <Text style={styles.emptyText}>
          The insurer hasn't published the details they need for this cover. Try another plan, or
          come back shortly.
        </Text>
      </View>
    );
  }

  const setField = (name: string, v: FieldValue) => {
    onChange({ ...values, [name]: v });
    // Clear the error as soon as the user edits — a stale red message under a
    // field they have already fixed reads as a bug.
    setErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev));
  };

  const showErrors = !!step && touchedSteps[step.key];

  const advance = () => {
    if (!step) return;
    const stepErrors = validateStep(step, values);
    setTouchedSteps((t) => ({ ...t, [step.key]: true }));
    if (Object.keys(stepErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...stepErrors }));
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setErrors((prev) => {
      const next = { ...prev };
      for (const f of step.fields) delete next[f.name];
      return next;
    });

    if (!isLast) {
      setStepIndex(safeIndex + 1);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    // Last step: re-check EVERY visible field, not just this one. A dependent
    // field that appeared after an earlier step was passed would otherwise slip
    // through un-validated.
    const all = validateAll(schema.fields, values);
    if (Object.keys(all).length > 0) {
      setErrors(all);
      const target = firstErroredStep(steps, all);
      if (target >= 0) {
        setStepIndex(target);
        setTouchedSteps((t) => ({ ...t, [steps[target].key]: true }));
      }
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    onSubmit(values);
  };

  const goBack = () => {
    if (safeIndex === 0) return;
    setStepIndex(safeIndex - 1);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        {header}

        {total > 1 ? <StepProgress steps={steps} current={safeIndex} /> : null}

        {step ? (
          <>
            <View style={styles.stepHead}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              {step.subtitle ? <Text style={styles.stepSubtitle}>{step.subtitle}</Text> : null}
            </View>

            {step.fields.map((field) => (
              <DynamicField
                key={field.name}
                field={field}
                value={values[field.name]}
                error={showErrors ? errors[field.name] || undefined : undefined}
                onChange={(v) => setField(field.name, v)}
              />
            ))}
          </>
        ) : null}

        {isLast ? footer : null}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          {safeIndex > 0 ? (
            <View style={styles.backBtn}>
              <PrimaryButton label="Back" variant="secondary" onPress={goBack} />
            </View>
          ) : null}
          <View style={styles.nextBtn}>
            <PrimaryButton
              label={isLast ? submitLabel : 'Continue'}
              onPress={advance}
              loading={submitting}
            />
          </View>
        </View>
        {total > 1 ? (
          <Text style={styles.stepCount}>
            Step {safeIndex + 1} of {total}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A segmented bar, one segment per step — cheaper to read than a "3/5" label. */
function StepProgress({ steps, current }: { steps: FormStep[]; current: number }) {
  return (
    <View style={styles.progress} accessibilityRole="progressbar">
      {steps.map((s, i) => (
        <View
          key={s.key}
          style={[
            styles.progressSeg,
            i < current && styles.progressDone,
            i === current && styles.progressCurrent,
          ]}
        />
      ))}
    </View>
  );
}

/** Count of fields the user still has to answer — used by the review screen. */
export function outstandingCount(schema: FormSchema | null, values: FormValues): number {
  if (!schema) return 0;
  return Object.keys(validateAll(visibleFields(schema.fields, values), values)).length;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  progress: { flexDirection: 'row', gap: 6, marginBottom: Spacing.lg },
  progressSeg: {
    flex: 1,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  progressDone: { backgroundColor: InsuranceColors.ok },
  progressCurrent: { backgroundColor: InsuranceColors.brand },

  stepHead: { marginBottom: Spacing.md, gap: Spacing.xs },
  stepTitle: { ...Typography.titleLg, color: Colors.onSurface },
  stepSubtitle: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },

  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
    gap: Spacing.sm,
  },
  footerRow: { flexDirection: 'row', gap: Spacing.sm },
  backBtn: { width: '32%' },
  nextBtn: { flex: 1 },
  stepCount: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },

  emptySchema: {
    margin: Spacing.containerMargin,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow,
    gap: Spacing.xs,
  },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  emptyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
});
