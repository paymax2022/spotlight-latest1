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
import { pickFileForField } from '@/features/registration/utils/filePicker';
import { IntakeField, RedFlagInterstitial, EmergencyBanner } from '@/features/health/components';
import {
  useApptIntake, useSaveApptDraft, useSubmitApptIntake,
} from '@/features/health/hooks';
import { presignAttachment, recordAttachment } from '@/features/health/api';
import { schemaAnswerNames } from '@/features/health/intakeMapping';
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
  const { id, resume, reason } = useLocalSearchParams<{
    id: string; resume?: string; reason?: string;
  }>();
  const appointmentId = id ?? '';

  const bundleQ = useApptIntake(appointmentId);
  const saveDraft = useSaveApptDraft(appointmentId);
  const submit = useSubmitApptIntake(appointmentId);

  const schema = bundleQ.data?.schema;
  const intake = bundleQ.data?.intake;
  // Optional-chain on `consent` too: a bundle that reached us without it (an older
  // server, an unexpected payload) must land on the error state, not throw here.
  const consent = bundleQ.data?.consent;
  const consentVersion = consent?.version ?? '';
  const acceptedVersion = consent?.acceptedVersion;
  // A submitted intake is immutable: service.go refuses both a draft save and a
  // resubmit once status='SUBMITTED'. Leaving the wizard editable would 400 on
  // every keystroke and land the patient on "Could not submit".
  const alreadySubmitted = intake?.status === 'SUBMITTED';

  const [values, setValues] = useState<IntakeResponseValues>({});
  const [errors, setErrors] = useState<IntakeErrors>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('wizard');
  const [redFlag, setRedFlag] = useState<RedFlagResult | null>(null);
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!bundleQ.data) return;
    // Re-consent cannot be recorded on an intake the server has frozen (the
    // consent screen saves through the same draft route), so a new consent
    // version must not bounce a submitted patient into a dead end.
    if (!alreadySubmitted && acceptedVersion !== consentVersion) {
      router.replace({
        pathname: '/services/telemedicine/appointment/[id]/intake/consent',
        params: { id: appointmentId },
      });
    }
  }, [bundleQ.data, alreadySubmitted, acceptedVersion, consentVersion, appointmentId]);

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
      // The storage name is reason_for_visit — the server's schema, not the mock's.
      if (!merged.reason_for_visit && typeof reason === 'string' && reason.trim()) {
        merged.reason_for_visit = reason.trim();
      }
      setValues(merged);
      // Files already recorded server-side (M16: reopening a draft or a submitted
      // intake must show what is already attached, not offer a duplicate upload).
      setAttachments(intake.attachments ?? []);
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

  // The keys the server's active schema declares. Everything else — the M12
  // attachment refs, or an older offline draft saved under a mock-mode vocabulary —
  // has to be dropped before it goes out, because intake.validate rejects an
  // unknown field name and that fails the whole save.
  const allowedNames = useMemo(
    () => schemaAnswerNames(schema?.steps ?? []),
    [schema],
  );

  // Debounced autosave: local first (offline-safe), then server.
  const persist = (next: IntakeResponseValues) => {
    setIntakeDraft(appointmentId, next).catch(() => {});
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft.mutate({ answers: next, consentVersion, allowedNames });
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

  const onPickAttachment = async (field: IntakeFieldT) => {
    const picked = await pickFileForField(field.accept);
    if (!picked) return;
    setAttachBusy(true);
    try {
      const { uploadUrl, attachment } = await presignAttachment(appointmentId, {
        fieldId: field.id, fileName: picked.name, mimeType: picked.mimeType,
      });
      // Live: PUT the file binary to the presigned URL, then tell the server the
      // object landed. Recording before a confirmed PUT would store a dead key.
      if (!uploadUrl.startsWith('mock://')) {
        const blob = await (await fetch(picked.uri)).blob();
        const put = await fetch(uploadUrl, {
          method: 'PUT', body: blob, headers: { 'Content-Type': picked.mimeType },
        });
        if (!put.ok) throw new Error(`upload refused (${put.status})`);
        await recordAttachment(appointmentId, attachment);
      }
      setAttachments((prev) => [...prev, attachment]);
      const nextRefs = [...attachments, attachment].map((a) => a.storageKey);
      setValue(field.id, nextRefs);
    } catch {
      alertAsync({ title: 'Upload failed', message: 'Could not attach that file. Please try again.' });
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
  if (bundleQ.isError || !schema || !intake || !consent) {
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
            Your doctor will review your intake before the consult begins. Once submitted, your
            answers are locked and can’t be changed here.
          </Text>
          <View style={styles.doneActions}>
            <PrimaryButton label="Back to appointment" onPress={() => router.replace(`/services/telemedicine/appointment/${appointmentId}` as never)} />
            <PrimaryButton label="View my health profile" variant="ghost" onPress={() => router.replace('/health/profile' as never)} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'review' || alreadySubmitted) {
    return (
      <ReviewScreen
        schema={schema}
        values={values}
        attachments={attachments}
        submitting={submit.isPending}
        readOnly={alreadySubmitted}
        onBack={() => setPhase('wizard')}
        onExit={() => router.replace(`/services/telemedicine/appointment/${appointmentId}` as never)}
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
    saveDraft.mutate({ answers: values, consentVersion, allowedNames });
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
      { answers: values, consentVersion, allowedNames },
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

          {step.prdScreen === 'M5' ? <EmergencyBanner /> : null}

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

function ReviewScreen({
  schema, values, attachments, submitting, readOnly, onBack, onExit, onSubmit,
}: {
  schema: PreConsultIntakeSchema;
  values: IntakeResponseValues;
  attachments: IntakeAttachment[];
  submitting: boolean;
  /** An already-submitted intake is frozen server-side: show it, don't edit it. */
  readOnly?: boolean;
  onBack: () => void;
  onExit: () => void;
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
      <ScreenHeader
        title={readOnly ? 'Your submitted intake' : 'Review & submit'}
        showBack={readOnly ? false : undefined}
        onBack={onBack}
      />
      <ScrollView contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
        <View style={styles.disclaimer}>
          <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.disclaimerText}>{INTAKE_NOT_DIAGNOSIS_COPY}</Text>
        </View>
        {readOnly ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Submitted — your answers are locked and can no longer be changed here.
            </Text>
          </View>
        ) : null}
        {steps.map((s) => (
          <View key={s.id} style={styles.reviewCard}>
            <Text style={styles.reviewTitle}>{s.title}</Text>
            {s.fields.map((f) => (
              <View key={f.id} style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>{f.label}</Text>
                <Text
                  style={[
                    styles.reviewVal,
                    f.critical && styles.reviewCritical,
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
        {readOnly ? (
          <View style={styles.nextWrap}>
            <PrimaryButton label="Back to appointment" onPress={onExit} />
          </View>
        ) : (
          <>
            <Pressable style={styles.backBtn} onPress={onBack} hitSlop={6}>
              <ChevronLeft size={20} color={Colors.onSurface} />
              <Text style={styles.backLabel}>Edit</Text>
            </Pressable>
            <View style={styles.nextWrap}>
              <PrimaryButton label="Submit intake" onPress={onSubmit} loading={submitting} />
            </View>
          </>
        )}
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
