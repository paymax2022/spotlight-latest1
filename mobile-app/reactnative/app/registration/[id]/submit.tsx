import React from 'react';
import { View, Text, ScrollView, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useDraft, useSubmitApplication } from '@/features/registration/hooks/useRegistration';
import type { RegistrationField, RegistrationStep, UploadedFileValue } from '@/features/registration/types/registration.types';

export default function RegistrationSubmitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = id ?? '';

  const draftQuery = useDraft(appId);
  const submit     = useSubmitApplication(appId);
  const [submitError, setSubmitError] = React.useState<string | undefined>();

  const draft = draftQuery.data?.draft;
  const steps: RegistrationStep[] = draftQuery.data?.steps ?? [];

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

  const onSubmit = () => {
    setSubmitError(undefined);
    submit.mutate(undefined, {
      onSuccess: () => router.replace(`/registration/${appId}/success` as never),
      onError: () => setSubmitError('Some required fields are still incomplete. Go back and complete every step, then try again.'),
    });
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
          />
        ) : (
          <PrimaryButton
            label="Submit application"
            onPress={onSubmit}
            loading={submit.isPending}
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
    return (
      <View style={styles.fileRow}>
        <Text style={styles.rowLabel}>{field.label}</Text>
        <View style={styles.previewWrap}>
          <Image source={{ uri: file.previewUrl }} style={styles.preview} resizeMode="cover" accessibilityLabel={`${field.label} preview`} />
          {file.fileName ? <Text style={styles.previewName} numberOfLines={1}>{file.fileName}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{field.label}</Text>
      <Text style={styles.rowValue}>{displayValue(field, value)}</Text>
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

  // ── Paid badge ──────────────────────────────────────────────────────────────
  paidBadge: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.teal,
  },
  paidLabel:  { ...Typography.labelMd, color: Colors.teal },
  paidRef:    { ...Typography.labelSm, color: Colors.onSurface, marginTop: 2 },
  paidMethod: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },

  // ── Unpaid / payment required badge ────────────────────────────────────────
  unpaidBadge: {
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.gold, gap: 4,
  },
  unpaidTitle: { ...Typography.labelMd, color: Colors.onSurface },
  unpaidBody:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },

  // ── Section cards ───────────────────────────────────────────────────────────
  section: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  row:      { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 4 },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },

  // ── File/image preview row ────────────────────────────────────────────────
  fileRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: 4 },
  previewWrap: { alignItems: 'flex-end', gap: 4, flexShrink: 1 },
  preview:     { width: 96, height: 96, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, borderWidth: 1, borderColor: Colors.outlineVariant },
  previewName: { ...Typography.labelSm, color: Colors.onSurfaceVariant, maxWidth: 140, textAlign: 'right' },

  errorBox:  { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md },
  errorText: { ...Typography.labelMd, color: Colors.error },

  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
  },
});
