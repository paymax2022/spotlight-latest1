import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Check, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/registration/components/WizardProgress';
import { pickFileForField } from '@/features/registration/utils/filePicker';
import { IntakeField, RedFlagInterstitial, EmergencyBanner } from '@/features/health/components';
import {
  useApptIntake, useSaveApptDraft, useSubmitApptIntake,
} from '@/features/health/hooks';
import { presignAttachment } from '@/features/health/api';
import {
  visibleSteps, validateStep, validatePreConsult, firstUnansweredStepIndex, formatMedList,
} from '@/features/health/utils';
import { INTAKE_NOT_DIAGNOSIS_COPY } from '@/features/health/constants/health.constants';
import {
  getIntakeDraft, setIntakeDraft, clearIntakeDraft,
} from '@/features/health/intakeDraftStore';
import type {
  IntakeResponseValues, IntakeValue, IntakeErrors, RedFlagResult, IntakeAttachment,
  IntakeField as IntakeFieldT, PreConsultIntakeSchema,
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
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Consent gate (M2): redirect to consent if not yet accepted ──────────────
  useEffect(() => {
    if (!bundleQ.data) return;
    if (acceptedVersion !== consentVersion) {
      router.replace({
        pathname: '/services/telemedicine/appointment/[id]/intake/consent',
        params: { id: appointmentId, ...(prebookingMode ? { prebooking: '1', doctorId: String(doctorId) } : {}) },
      });
    }
  }, [bundleQ.data, acceptedVersion, consentVersion, appointmentId, prebookingMode, doctorId]);

  // ── Hydrate local-first (offline draft) then reconcile with server draft ────
  useEffect(() => {
    if (hydrated.current || !intake) return;
    let cancelled = false;
    (async () => {
      const local = await getIntakeDraft(appointmentId);
      if (cancelled) return;
      // Server answers win on conflict (last write), local fills gaps offline.
      const merged: IntakeResponseValues = { ...(local ?? {}), ...intake.answers };
      // Prefill the chief complaint from the "reason for visit" typed at booking,
      // so we never re-ask what the patient already told us (PRD §3 low-friction).
      if (!merged.chief_complaint && typeof reason === 'string' && reason.trim()) {
        merged.chief_complaint = reason.trim();
      }
      setValues(merged);
      hydrated.current = true;
      // M3 resume: jump to the first unanswered step.
      if (resume === '1' && schema) {
        setStepIndex(firstUnansweredStepIndex(schema, merged));
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
      const next = { ...prev, [fieldId]: value };
      persist(next);
      return next;
    });
    setErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const { [fieldId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  // ── Attachments (M12): pick → presign → (mock) PUT → store reference ────────
  const onPickAttachment = async (field: IntakeFieldT) => {
    const picked = await pickFileForField(field.accept);
    if (!picked) return;
    setAttachBusy(true);
    try {
      const { uploadUrl, attachment } = await presignAttachment(appointmentId, {
        fieldId: field.id, fileName: picked.name, mimeType: picked.mimeType,
      });
      // Live: PUT the file binary to uploadUrl. Mock URLs are no-ops.
      if (!uploadUrl.startsWith('mock://')) {
        const blob = await (await fetch(picked.uri)).blob();
        await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': picked.mimeType } });
      }
      setAttachments((prev) => [...prev, attachment]);
      const nextRefs = [...attachments, attachment].map((a) => a.storageKey);
      setValue(field.id, nextRefs);
    } catch {
      Alert.alert('Upload failed', 'Could not attach that file. Please try again.');
    } finally {
      setAttachBusy(false);
    }
  };

  const removeAttachment = (attId: string, fieldId: string) => {
    const next = attachments.filter((a) => a.id !== attId);
    setAttachments(next);
    setValue(fieldId, next.filter((a) => a.fieldId === fieldId).map((a) => a.storageKey));
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

  // ── M13 Red-flag interstitial ───────────────────────────────────────────────
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

  // ── M15 Submission confirmation ─────────────────────────────────────────────
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

  // ── M14 Review & submit ─────────────────────────────────────────────────────
  if (phase === 'review') {
    return (
      <ReviewScreen
        schema={schema}
        values={values}
        attachments={attachments}
        submitting={submit.isPending}
        onBack={() => setPhase('wizard')}
        onSubmit={onSubmit}
      />
    );
  }

  // ── M4–M12 wizard ───────────────────────────────────────────────────────────
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
    if (stepIndex === 0) router.back();
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
      Alert.alert('Please review', 'Some required answers are missing or invalid.');
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
        onError: () => Alert.alert('Could not submit', 'Please try again.'),
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

          {step.fields.map((field) => (
            <IntakeField
              key={field.id}
              field={field}
              value={values[field.id] ?? null}
              error={errors[field.id]}
              onChange={(v) => setValue(field.id, v)}
              onPickAttachment={onPickAttachment}
              attachments={attachments.filter((a) => a.fieldId === field.id)}
              onRemoveAttachment={(attId) => removeAttachment(attId, field.id)}
              attachmentBusy={attachBusy}
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

// ── M14 Review & submit (full summary) ────────────────────────────────────────
function ReviewScreen({
  schema, values, attachments, submitting, onBack, onSubmit,
}: {
  schema: PreConsultIntakeSchema;
  values: IntakeResponseValues;
  attachments: IntakeAttachment[];
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const steps = visibleSteps(schema, values);

  const renderValue = (field: IntakeFieldT): string => {
    const v = values[field.id];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return '—';
    if (field.type === 'boolean') return v ? 'Yes' : 'No';
    if (field.type === 'med_list') { const lines = formatMedList(v); return lines.length ? lines.join(', ') : '—'; }
    if (field.type === 'attachment') return `${attachments.filter((a) => a.fieldId === field.id).length} file(s)`;
    if (Array.isArray(v)) {
      const labels = v.map((val) => field.options?.find((o) => o.value === val)?.label ?? val);
      return labels.join(', ');
    }
    if (field.options) return field.options.find((o) => o.value === v)?.label ?? String(v);
    return String(v);
  };

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
            {s.fields.map((f) => (
              <View key={f.id} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{f.label}</Text>
                <Text
                  style={[
                    styles.reviewVal,
                    (f.id === 'allergies_list' || f.id === 'medications_list') && styles.reviewCritical,
                  ]}
                >
                  {renderValue(f)}
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
