// ── Paymax Health — Vet Mode B (assisted) VCN verification ──────────────────
// HL-2 assisted path: the vet is verified WITHOUT ever seeing the VCN portal.
// The member submits their VCN registration number + name + DOB + documents and
// gives NDPA consent; ops confirms out-of-band and records a decision. Capability
// is granted only on approval. The member only ever sees a coarse stage on the
// status screen — never register data, matched fields, reviewer, or notes.

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, FileCheck2, UploadCloud, Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useProviderProfile, useSubmitVcnVerification } from '@/features/health/vet/hooks';
import type { VcnDocType, VcnSubmitDoc } from '@/features/health/vet/types';

// Document rows the member attaches. VCN_CERT + ANNUAL_LICENCE are required.
const DOC_ROWS: { type: VcnDocType; label: string; required: boolean }[] = [
  { type: 'VCN_CERT', label: 'VCN certificate', required: true },
  { type: 'ANNUAL_LICENCE', label: 'Current annual practising licence', required: true },
  { type: 'GOV_ID', label: 'Government ID', required: false },
];

// Mock-first "attach document": in USE_MOCK there is no real DocumentPicker, so we
// mint a fake storage_key (mirrors pharmacy upload-rx). In live mode the same
// affordance would hand off to the existing upload pipeline to obtain the key.
function fakeStorageKey(type: VcnDocType): string {
  return `vet/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}/${type}`;
}

export default function VetVcnVerificationScreen() {
  const { data: profile, isLoading, isError, refetch } = useProviderProfile();
  const submit = useSubmitVcnVerification();

  const [regNumber, setRegNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [consent, setConsent] = useState(false);
  const [docs, setDocs] = useState<Partial<Record<VcnDocType, string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verify your VCN licence" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verify your VCN licence" />
        <StateView kind="error" title="Couldn't load verification" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  // The provider profile carries the application id Mode B verification is scoped to.
  const applicationId = profile.applicationId;

  const toggleDoc = (type: VcnDocType) => {
    setDocs((prev) => {
      const next = { ...prev };
      if (next[type]) delete next[type];
      else next[type] = fakeStorageKey(type);
      return next;
    });
  };

  const onSubmit = () => {
    const e: Record<string, string> = {};
    if (!applicationId) e.application = 'Complete vet onboarding before verifying your licence.';
    if (!regNumber.trim()) e.regNumber = 'VCN registration number is required';
    if (!fullName.trim()) e.fullName = 'Full name is required';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) e.dob = 'Use the format YYYY-MM-DD';
    if (!docs.VCN_CERT) e.VCN_CERT = 'Attach your VCN certificate';
    if (!docs.ANNUAL_LICENCE) e.ANNUAL_LICENCE = 'Attach your current annual practising licence';
    if (!consent) e.consent = 'Consent is required to verify your credentials';
    setErrors(e);
    if (Object.keys(e).length || !applicationId) return;

    const submitDocs: VcnSubmitDoc[] = (Object.keys(docs) as VcnDocType[]).map((type) => ({
      type,
      storageKey: docs[type] as string,
    }));

    submit.mutate(
      {
        applicationId,
        regNumber: regNumber.trim(),
        fullName: fullName.trim(),
        dob: dob.trim(),
        consent,
        docs: submitDocs,
      },
      {
        onSuccess: () =>
          router.push({
            pathname: '/health/vet/provider/verification-status',
            params: { applicationId },
          }),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verify your VCN licence" subtitle="Assisted verification — no portal needed" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.introText}>
            Submit your credentials and documents below. We verify them with the Veterinary Council of
            Nigeria on your behalf — you never need to visit the VCN portal. Verification usually takes
            1–2 business days.
          </Text>
        </View>

        <TextInputField
          label="VCN registration number *"
          placeholder="e.g. VCN-2014-0912"
          value={regNumber}
          onChangeText={setRegNumber}
          autoCapitalize="characters"
          error={errors.regNumber}
        />
        <TextInputField
          label="Full name (as registered) *"
          placeholder="Dr. …"
          value={fullName}
          onChangeText={setFullName}
          error={errors.fullName}
        />
        <TextInputField
          label="Date of birth (YYYY-MM-DD) *"
          placeholder="1985-04-21"
          value={dob}
          onChangeText={setDob}
          keyboardType="numbers-and-punctuation"
          error={errors.dob}
        />

        <Text style={styles.sectionLabel}>Documents</Text>
        {DOC_ROWS.map((row) => {
          const attached = Boolean(docs[row.type]);
          const rowError = errors[row.type];
          return (
            <View key={row.type}>
              <Pressable
                style={[styles.docRow, attached && styles.docRowFilled, !!rowError && styles.docRowError]}
                onPress={() => toggleDoc(row.type)}
                accessibilityRole="button"
                accessibilityLabel={`Attach ${row.label}`}
              >
                <View style={[styles.docIcon, attached && styles.docIconFilled]}>
                  {attached ? (
                    <FileCheck2 size={20} color={Colors.teal} strokeWidth={2} />
                  ) : (
                    <UploadCloud size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  )}
                </View>
                <View style={styles.docBody}>
                  <Text style={styles.docLabel}>
                    {row.label}
                    {row.required ? ' *' : ''}
                  </Text>
                  <Text style={styles.docMeta}>{attached ? 'Attached — tap to remove' : 'Tap to attach (PDF, JPG or PNG)'}</Text>
                </View>
                {attached ? <X size={18} color={Colors.onSurfaceVariant} /> : null}
              </Pressable>
              {rowError ? <Text style={styles.error}>{rowError}</Text> : null}
            </View>
          );
        })}

        {/* NDPA consent — required */}
        <Pressable
          style={styles.consentRow}
          onPress={() => setConsent((c) => !c)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
        >
          <View style={[styles.checkbox, consent && styles.checkboxChecked]}>
            {consent ? <Check size={14} color={Colors.surfaceContainerLowest} strokeWidth={3} /> : null}
          </View>
          <Text style={styles.consentText}>
            I consent to Paymax verifying my veterinary credentials with the relevant authority.
          </Text>
        </Pressable>
        {errors.consent ? <Text style={styles.error}>{errors.consent}</Text> : null}
        {errors.application ? <Text style={styles.error}>{errors.application}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit for verification" onPress={onSubmit} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  intro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  introText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  docRowFilled: { borderStyle: 'solid', borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  docRowError: { borderStyle: 'solid', borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
  },
  docIconFilled: { backgroundColor: Colors.surfaceContainerLowest },
  docBody: { flex: 1, gap: 2 },
  docLabel: { ...Typography.labelMd, color: Colors.onSurface },
  docMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
