import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { alertAsync } from '@/lib/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ChevronLeft, Check, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/registration/components/WizardProgress';
import { IntakeField, RedFlagInterstitial, EmergencyBanner } from '@/features/health/components';
import {
  INTAKE_UPLOAD_UNAVAILABLE_COPY,
  useApptIntake, useSaveApptDraft, useSubmitApptIntake,
} from '@/features/telemedicine/intake';
import {
  visibleSteps, stepFields, applyGateAnswer, reconcileGates, validateStep, validatePreConsult,
  firstUnansweredStepIndex, formatIntakeValue,
} from '@/features/health/utils';
import { INTAKE_NOT_DIAGNOSIS_COPY } from '@/features/health/constants/health.constants';
import {
  getIntakeDraft, setIntakeDraft, clearIntakeDraft,
} from '@/features/health/intakeDraftStore';
import type {
  IntakeResponseValues, IntakeValue, IntakeErrors, RedFlagResult,
  PreConsultIntakeSchema,
} from '@/features/health/types';

type Phase = 'wizard' | 'review' | 'redflag' | 'done';

export default function PreConsultIntakeWizard() {
  const { id, resume, reason, prebooking, doctorId } = useLocalSearchParams<{
    id: string; resume?: string; reason?: string; prebooking?: string; doctorId?: string;
  }>();
  const appointmentId = id ?? '';
  // Pre-booking mode: the triage runs from the doctor profile BEFORE an appointment
  // exists (keyed by a synthetic `pre-<doctorId>` id). On completion we continue to
  // booking; the answers are submitted to the real appointment at payment.
  const prebookingMode = prebooking === '1' && !!doctorId;

  const bundleQ = useApptIntake(appointmentId);
  const saveDraft = useSaveApptDraft(appointmentId);
  const submit = useSubmitApptIntake(appointmentId);

  const schema = bundleQ.data?.schema;
  const intake = bundleQ.data?.intake;
  const consentVersion = bundleQ.data?.consent.version ?? '';
  const acceptedVersion = bundleQ.data?.consent.acceptedVersion;

  const [values, setValues] = useState<IntakeResponseValues>({});
  const [errors, setErrors] = useState<IntakeErrors>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('wizard');
  const [redFlag, setRedFlag] = useState<RedFlagResult | null>(null);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!bundleQ.data) return;
    if (acceptedVersion !== consentVersion) {
      router.replace({
        pathname: '/services/telemedicine/appointment/[id]/intake/consent',
        params: { id: appointmentId, ...(prebookingMode ? { prebooking: '1', doctorId: String(doctorId) } : {}) },
      });
    }
  }, [bundleQ.data, acceptedVersion, consentVersion, appointmentId, prebookingMode, doctorId]);

  useEffect(() => {
    if (hydrated.current || !intake) return;
    let cancelled = false;
    (async () => {
      const local = await getIntakeDraft(appointmentId);
      if (cancelled) return;
      // Server answers win on conflict (last write), local fills gaps offline.
      const merged: IntakeResponseValues = { ...(local ?? {}), ...intake.answers };
      // A draft written before the gate hid its detail can hold both "No allergies"
      // and an allergen list — the doctor would read the contradiction. Reconcile.
      const gated = reconcileGates(merged);
      // Prefill the chief complaint from the "reason for visit" typed at booking,
      // so we never re-ask what the patient already told us (PRD §3 low-friction).
      if (!gated.chief_complaint && typeof reason === 'string' && reason.trim()) {
        gated.chief_complaint = reason.trim();
      }
      setValues(gated);
      hydrated.current = true;
      // M3 resume: jump to the first unanswered step.
      if (resume === '1' && schema) {
        setStepIndex(firstUnansweredStepIndex(schema, gated));
      }
    })();
    return () => { cancelled = true; };
  }, [intake, schema, appointmentId, resume, reason]);

  const steps = useMemo(
    () => (schema ? visibleSteps(schema, values) : []),
    [schema, values],
  );
  const step = steps[stepIndex];

  // Debounced autosave: local first (offline-safe), then server.
  const persist = (next: IntakeResponseValues) => {
    setIntakeDraft(appointmentId, next).catch(() => {});
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft.mutate({ answers: next, consentVersion });
    }, 600);
  };

  const setValue = (fieldId: string, value: IntakeValue) => {
    setValues((prev) => {
      const next = applyGateAnswer({ ...prev, [fieldId]: value }, fieldId);
      persist(next);
      return next;
    });
    setErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const { [fieldId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  if (bundleQ.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Health intake" />
        <StateView kind="loading" message="Loading your intake…" />
      </SafeAreaView>
    );
  }
  if (bundleQ.isError || !schema || !intake) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Health intake" />
        <StateView kind="error" title="Couldn’t load intake" message="Please try again." actionLabel="Retry" onAction={() => bundleQ.refetch()} />
      </SafeAreaView>
    );
  }

  if (phase === 'redflag' && redFlag) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Important" showBack={false} />
        <ScrollView contentContainerStyle={styles.flexGrow}>
          <RedFlagInterstitial
            result={redFlag}
            onContinue={() => goDone()}
            onDismiss={() => router.replace(`/services/telemedicine/appointment/${appointmentId}` as never)}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (phase === 'done') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="All set" showBack={false} />
        <View style={styles.doneWrap}>
          <View style={styles.doneIcon}><Check size={34} color={Colors.teal} strokeWidth={3} /></View>
          <Text style={styles.doneTitle}>Your details are ready for {intake.doctorName ?? 'your doctor'}</Text>
          <Text style={styles.doneBody}>
            Your doctor will review your intake before the consult begins. You can update it any time
            before the consult starts.
          </Text>
          <View style={styles.doneActions}>
            <PrimaryButton label="Back to appointment" onPress={() => router.replace(`/services/telemedicine/appointment/${appointmentId}` as never)} />
            <PrimaryButton label="View my health profile" variant="ghost" onPress={() => router.replace('/health/profile' as never)} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'review') {
    return (
      <ReviewScreen
        schema={schema}
        values={values}
        submitting={submit.isPending}
        onBack={() => setPhase('wizard')}
        onSubmit={onSubmit}
      />
    );
  }

  if (!step) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Health intake" />
        <StateView kind="empty" title="Nothing to fill in" message="This intake has no steps." />
      </SafeAreaView>
    );
  }

  const isLastStep = stepIndex === steps.length - 1;

  const handleNext = () => {
    const stepErrors = validateStep(step, values);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    // Persist immediately on Next (don't wait for debounce).
    saveDraft.mutate({ answers: values, consentVersion });
    if (isLastStep) {
      setPhase('review');
    } else {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }
  };

  const handleBack = () => {
    if (stepIndex === 0) goBack('/services/telemedicine');
    else setStepIndex((i) => Math.max(0, i - 1));
  };

  function goDone() {
    if (prebookingMode && doctorId) {
      // Pre-booking triage complete → continue to booking. Keep the draft under
      // `pre-<doctorId>` so the answers transfer to the real appointment at payment.
      const chief = typeof values.chief_complaint === 'string' ? values.chief_complaint : '';
      router.replace({
        pathname: '/services/telemedicine/doctor/[id]/book',
        params: { id: String(doctorId), reason: chief, intakeReady: '1' },
      });
      return;
    }
    clearIntakeDraft(appointmentId).catch(() => {});
    setPhase('done');
  }

  function onSubmit() {
    const found = validatePreConsult(schema as PreConsultIntakeSchema, values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setPhase('wizard');
      alertAsync({ title: 'Please review', message: 'Some required answers are missing or invalid.' });
      return;
    }
    submit.mutate(
      { answers: values, consentVersion },
      {
        onSuccess: (res) => {
          if (res.red_flag) {
            setRedFlag(res.red_flag);
            setPhase('redflag');
            return;
          }
          goDone();
        },
        onError: () => alertAsync({ title: 'Could not submit', message: 'Please try again.' }),
      },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Health intake" subtitle={step.title} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <WizardProgress stepIndex={stepIndex} stepCount={steps.length} title={step.title} description={step.description} />

        <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.disclaimer}>
            <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.disclaimerText}>{INTAKE_NOT_DIAGNOSIS_COPY}</Text>
          </View>

          {step.id === 'symptom_detail' ? <EmergencyBanner /> : null}

          {Object.keys(errors).length > 0 ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Please complete the highlighted fields.</Text>
            </View>
          ) : null}

          {stepFields(step, values).map((field) => (
            <IntakeField
              key={field.id}
              field={field}
              value={values[field.id] ?? null}
              error={errors[field.id]}
              onChange={(v) => setValue(field.id, v)}
              attachmentNote={INTAKE_UPLOAD_UNAVAILABLE_COPY}
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
              loading={saveDraft.isPending}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ReviewScreen({
  schema, values, submitting, onBack, onSubmit,
}: {
  schema: PreConsultIntakeSchema;
  values: IntakeResponseValues;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const steps = visibleSteps(schema, values);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review & submit" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
        <View style={styles.disclaimer}>
          <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.disclaimerText}>{INTAKE_NOT_DIAGNOSIS_COPY}</Text>
        </View>
        {steps.map((s) => (
          <View key={s.id} style={styles.reviewCard}>
            <Text style={styles.reviewTitle}>{s.title}</Text>
            {stepFields(s, values).map((f) => (
              <View key={f.id} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{f.label}</Text>
                <Text
                  style={[
                    styles.reviewVal,
                    (f.id === 'allergies_list' || f.id === 'medications_list') && styles.reviewCritical,
                  ]}
                >
                  {formatIntakeValue(f, values[f.id])}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable style={styles.backBtn} onPress={onBack} hitSlop={6}>
          <ChevronLeft size={20} color={Colors.onSurface} />
          <Text style={styles.backLabel}>Edit</Text>
        </Pressable>
        <View style={styles.nextWrap}>
          <PrimaryButton label="Submit intake" onPress={onSubmit} loading={submitting} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1, justifyContent: 'center' },
  form: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  disclaimer: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md, paddingHorizontal: Spacing.sm + 2, paddingVertical: 8, marginBottom: Spacing.xs,
  },
  disclaimerText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 16 },
  banner: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  bannerText: { ...Typography.labelMd, color: Colors.onSurface },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 28 : Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, paddingRight: Spacing.sm },
  backLabel: { ...Typography.labelLg, color: Colors.onSurface },
  nextWrap: { flex: 1 },
  // review
  reviewCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, marginBottom: Spacing.sm,
  },
  reviewTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 4 },
  reviewLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  reviewVal: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  reviewCritical: { color: Colors.error, fontWeight: '700' as const },
  // done (M15)
  doneWrap: { flex: 1, padding: Spacing.lg, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  doneIcon: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  doneBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 22 },
  doneActions: { width: '100%', gap: Spacing.sm, marginTop: Spacing.md },
});
