import React from 'react';
import { View, Text, ScrollView, StyleSheet, Image, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle, CheckCircle2, Circle, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { resolveUploadUrl } from '@/features/registration/api/registration.client';
import { useDraft, useSubmitApplication } from '@/features/registration/hooks/useRegistration';
import {
  getEditionRulesBySlug, getMyRulesAcceptanceBySlug, acceptEditionRulesBySlug,
} from '@/features/voting/api/edition.api';
import type { EditionRules } from '@/features/voting/types/edition.types';
import type { RegistrationField, RegistrationStep, UploadedFileValue } from '@/features/registration/types/registration.types';

export default function RegistrationSubmitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = id ?? '';

  const draftQuery = useDraft(appId);
  const submit     = useSubmitApplication(appId);
  const [submitError, setSubmitError] = React.useState<string | undefined>();

  const draft = draftQuery.data?.draft;
  const steps: RegistrationStep[] = draftQuery.data?.steps ?? [];

  // ── §5 rules-acceptance gate ────────────────────────────────────────────────
  // The edition is resolved from the draft's contestSlug (the connect_contests
  // slug). If that edition has PUBLISHED rules, registration cannot complete
  // until the authenticated user ticks the box; ticking + submitting records the
  // exact rules version accepted (user + edition + version, immutable). An
  // edition with no published rules shows no gate, so existing registration is
  // unchanged (criterion #15).
  const contestSlug = (draft?.contestSlug ?? '') as string;
  const [rules, setRules] = React.useState<EditionRules | null>(null);
  const [alreadyAccepted, setAlreadyAccepted] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);
  const [acceptError, setAcceptError] = React.useState<string | undefined>();

  React.useEffect(() => {
    let alive = true;
    if (!contestSlug) { return; }
    void (async () => {
      const [r, prior] = await Promise.all([
        getEditionRulesBySlug(contestSlug),
        getMyRulesAcceptanceBySlug(contestSlug),
      ]);
      if (!alive) return;
      setRules(r);
      setAlreadyAccepted(!!prior);
    })();
    return () => { alive = false; };
  }, [contestSlug]);

  // A gate is required only when rules are published AND not already accepted.
  const requiresAcceptance = !!rules && !alreadyAccepted;

  // Payment state derived from formData (set by the payment screens).
  const feeNgn       = Number(draft?.formData['payment.feeAmount'] ?? 0);
  const isPaidContest = feeNgn > 0;
  const paymentDone  = draft?.formData['payment.paymentStatus'] === 'paid';
  const paymentRef   = draft?.formData['payment.transactionReference'] as string | undefined;
  const paymentMethod = draft?.formData['payment.method'] as string | undefined;

  const needsPayment = isPaidContest && !paymentDone;

  if (draftQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review & submit" />
        <StateView kind="loading" message="Preparing your review…" />
      </SafeAreaView>
    );
  }

  if (draftQuery.isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review & submit" />
        <StateView kind="error" title="Couldn't load application" actionLabel="Retry" onAction={() => draftQuery.refetch()} />
      </SafeAreaView>
    );
  }

  const doSubmit = () => {
    submit.mutate(undefined, {
      onSuccess: () => router.replace(`/registration/${appId}/success` as never),
      onError: () => setSubmitError('Some required fields are still incomplete. Go back and complete every step, then try again.'),
    });
  };

  const onSubmit = async () => {
    setSubmitError(undefined);
    setAcceptError(undefined);

    // §5 gate: when this edition has published rules the user has not yet
    // accepted, submission is blocked until the box is ticked, and the acceptance
    // is recorded (user + edition + rules version) BEFORE the application submits.
    // A failure to record is fatal — we never submit an unaccepted application.
    if (requiresAcceptance) {
      if (!accepted) {
        setAcceptError('You must read and accept the contest rules before submitting your application.');
        return;
      }
      try {
        await acceptEditionRulesBySlug(contestSlug, appId, rules?.id);
        setAlreadyAccepted(true);
      } catch (e) {
        setAcceptError(e instanceof Error ? e.message : 'Could not record your rules acceptance. Please try again.');
        return;
      }
    }

    doSubmit();
  };

  const goToPayment = () => {
    router.push(`/registration/${appId}/payment` as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review & submit" subtitle={draft.reference} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Review your answers before submitting.</Text>

        {/* ── Payment status callout ─────────────────────────────────────── */}
        {isPaidContest && (
          paymentDone ? (
            <View style={styles.paidBadge}>
              <CheckCircle size={18} color={Colors.teal} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.paidLabel}>Registration fee paid</Text>
                <Text style={styles.paidRef}>Ref: {paymentRef}</Text>
                {paymentMethod ? <Text style={styles.paidMethod}>via {paymentMethod}</Text> : null}
              </View>
            </View>
          ) : (
            <View style={styles.unpaidBadge}>
              <Text style={styles.unpaidTitle}>Payment required</Text>
              <Text style={styles.unpaidBody}>
                This contest has a ₦{feeNgn.toLocaleString('en-NG')} registration fee. Complete payment before submitting your application.
              </Text>
            </View>
          )
        )}

        {/* ── Form data summary ──────────────────────────────────────────── */}
        {steps.map((step) => (
          <View key={step.key} style={[styles.section, shadow1]}>
            <Text style={styles.sectionTitle}>{step.title}</Text>
            {step.fields
              .filter((f) => f.type !== 'password')
              .map((field) => (
                <SummaryRow key={field.key} field={field} value={draft.formData[field.key]} />
              ))}
          </View>
        ))}

        {/* ── §5 Rules acceptance gate ─────────────────────────────────────── */}
        {rules && (
          <View style={[styles.rulesCard, shadow1]}>
            <View style={styles.rulesHead}>
              <ShieldCheck size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.rulesHeadText}>Contest Rules & Regulations</Text>
            </View>
            <Text style={styles.rulesMeta}>
              Version {rules.version}
              {rules.published_at ? ` · Published ${new Date(rules.published_at).toLocaleDateString()}` : ''}
            </Text>

            {alreadyAccepted ? (
              <View style={styles.rulesAcceptedRow}>
                <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.rulesAcceptedText}>You have accepted these rules.</Text>
              </View>
            ) : (
              <>
                <Pressable
                  style={styles.rulesCheckRow}
                  onPress={() => setAccepted((a) => !a)}
                  disabled={submit.isPending}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: accepted }}
                >
                  {accepted
                    ? <CheckCircle2 size={22} color={Colors.primary} />
                    : <Circle size={22} color={Colors.onSurfaceVariant} />}
                  <Text style={styles.rulesCheckText}>
                    I have read, understood and agree to the Spotlight Rising Star contest rules and regulations for this edition.
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/voting/edition-rules?slug=${encodeURIComponent(contestSlug)}&applicationId=${encodeURIComponent(appId)}&contestTitle=${encodeURIComponent(String(draft.formData['contest.title'] ?? 'Spotlight Rising Star'))}` as never)}
                >
                  <Text style={styles.rulesReadLink}>Read the full rules</Text>
                </Pressable>
              </>
            )}

            {!!acceptError && <Text style={styles.acceptErrorText}>{acceptError}</Text>}
          </View>
        )}

        {submitError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {needsPayment ? (
          <PrimaryButton
            label={`Pay ₦${feeNgn.toLocaleString('en-NG')} & Continue`}
            onPress={goToPayment}
            loading={false}
            disabled={requiresAcceptance && !accepted}
          />
        ) : (
          <PrimaryButton
            label="Submit application"
            onPress={onSubmit}
            loading={submit.isPending}
            disabled={requiresAcceptance && !accepted}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({ field, value }: { field: RegistrationField; value: unknown }) {
  // Image uploads: show the actual picture as a thumbnail, not just the filename.
  const file = field.type === 'file' && value && typeof value === 'object' ? (value as UploadedFileValue) : undefined;
  if (file?.previewUrl && isImageUpload(field, file)) {
    return <ImageSummaryRow field={field} file={file} />;
  }
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{field.label}</Text>
      <Text style={styles.rowValue}>{displayValue(field, value)}</Text>
    </View>
  );
}

function ImageSummaryRow({ field, file }: { field: RegistrationField; file: UploadedFileValue }) {
  const [uri, setUri] = React.useState<string | undefined>();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setUri(undefined);
    setFailed(false);
    resolveUploadUrl(file.previewUrl)
      .then((u) => { if (!cancelled) setUri(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file.previewUrl]);

  return (
    <View style={styles.fileRow}>
      <Text style={styles.rowLabel}>{field.label}</Text>
      <View style={styles.previewWrap}>
        {uri && !failed ? (
          <Image
            source={{ uri }}
            style={styles.preview}
            resizeMode="cover"
            onError={() => setFailed(true)}
            accessibilityLabel={`${field.label} preview`}
          />
        ) : (
          <View style={[styles.preview, styles.previewPlaceholder]}>
            {failed ? <Text style={styles.previewName}>📎</Text> : <ActivityIndicator size="small" color={Colors.primary} />}
          </View>
        )}
        {file.fileName ? <Text style={styles.previewName} numberOfLines={1}>{file.fileName}</Text> : null}
      </View>
    </View>
  );
}

// A file upload is previewable as an image when its field accepts images or the
// stored file/URL has a known image extension.
function isImageUpload(field: RegistrationField, file: UploadedFileValue): boolean {
  if (field.accept && /image/i.test(field.accept)) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)(\?|#|$)/i.test(file.fileName || file.previewUrl);
}

function displayValue(field: RegistrationField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (field.type === 'file' && typeof value === 'object') {
    const v = value as { fileName?: string };
    return v.fileName ? `📎 ${v.fileName}` : 'Uploaded';
  }
  return String(value);
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  intro:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant },

  paidBadge: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.teal,
  },
  paidLabel:  { ...Typography.labelMd, color: Colors.teal },
  paidRef:    { ...Typography.labelSm, color: Colors.onSurface, marginTop: 2 },
  paidMethod: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },

  unpaidBadge: {
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.gold, gap: 4,
  },
  unpaidTitle: { ...Typography.labelMd, color: Colors.onSurface },
  unpaidBody:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },

  section: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  row:      { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 4 },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },

  fileRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: 4 },
  previewWrap: { alignItems: 'flex-end', gap: 4, flexShrink: 1 },
  preview:     { width: 96, height: 96, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, borderWidth: 1, borderColor: Colors.outlineVariant },
  previewPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  previewName: { ...Typography.labelSm, color: Colors.onSurfaceVariant, maxWidth: 140, textAlign: 'right' },

  errorBox:  { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md },
  errorText: { ...Typography.labelMd, color: Colors.error },

  rulesCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm,
  },
  rulesHead:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rulesHeadText: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  rulesMeta:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rulesAcceptedRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rulesAcceptedText: { ...Typography.labelMd, color: Colors.teal },
  rulesCheckRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  rulesCheckText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  rulesReadLink:  { ...Typography.labelMd, color: Colors.primary, fontWeight: '600' },
  acceptErrorText: { ...Typography.labelMd, color: Colors.error },

  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
  },
});
