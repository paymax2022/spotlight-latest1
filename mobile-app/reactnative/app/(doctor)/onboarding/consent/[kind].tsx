import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, FileWarning } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { ConsentDocView, StateView, DisclaimerBanner } from '@/features/doctor/components';
import { useLegalDocument, useAcceptConsent, useConsentStatus } from '@/features/doctor/hooks';
import { LEGAL_DOC_LABELS, LEGAL_DOC_ORDER } from '@/features/doctor/constants';
import type { LegalDocKind } from '@/types/doctor.onboarding';

// ── Section A · Entries 8–12 — One versioned consent screen ──────────────────
// Parameterised by LegalDocKind. Renders the document (ConsentDocView) with a
// scroll, an accept checkbox, and submits the accepted *version* via
// useAcceptConsent. On success returns to the consent hub.

const VALID_KINDS = new Set<LegalDocKind>(LEGAL_DOC_ORDER);

export default function ConsentScreen() {
  const { kind: rawKind } = useLocalSearchParams<{ kind: string }>();
  const kind = rawKind as LegalDocKind;
  const valid = VALID_KINDS.has(kind);

  const { data: doc, isLoading, isError, refetch } = useLegalDocument(kind);
  const { data: consentStatus } = useConsentStatus();
  const accept = useAcceptConsent();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();

  const alreadyAccepted = (consentStatus?.accepted ?? []).some(
    (r) => r.kind === kind && r.version === doc?.version,
  );

  const handleAccept = async () => {
    if (!doc) return;
    if (!agreed) {
      setError('Please tick the box to confirm you have read and agree.');
      return;
    }
    setError(undefined);
    try {
      // Versioned acceptance: send the exact version the user is accepting.
      await accept.mutateAsync({ kind, version: doc.version });
      router.back();
    } catch {
      setError('Could not record your acceptance. Please try again.');
    }
  };

  if (!valid) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Agreement" />
        <StateView variant="empty" icon={FileWarning} title="Unknown agreement" message="This agreement could not be found." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title={LEGAL_DOC_LABELS[kind]} />

      {isLoading && !doc ? (
        <StateView variant="loading" label="Loading agreement" />
      ) : isError || !doc ? (
        <StateView variant="error" message="We could not load this agreement." onRetry={() => refetch()} />
      ) : (
        <View style={styles.flex}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={styles.title}>{doc.title}</Text>
            {doc.requiresReacceptance && (
              <View style={styles.reaccept}>
                <DisclaimerBanner text="This document has been updated. Please review and re-accept the new version." />
              </View>
            )}

            <ConsentDocView
              summary={doc.summary}
              sections={doc.sections}
              bodyMarkdown={doc.bodyMarkdown}
              version={doc.version}
              effectiveDate={doc.effectiveDate}
            />

            <Pressable
              onPress={() => setAgreed((v) => !v)}
              style={styles.agreeRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              accessibilityLabel={`I have read and agree to the ${LEGAL_DOC_LABELS[kind]}`}
            >
              <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                {agreed && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
              </View>
              <Text style={styles.agreeText}>
                I have read and agree to the {LEGAL_DOC_LABELS[kind]} (v{doc.version}).
              </Text>
            </Pressable>

            {!!error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={alreadyAccepted ? 'Accepted — done' : 'Accept & continue'}
              onPress={alreadyAccepted ? () => router.back() : handleAccept}
              loading={accept.isPending}
              disabled={!alreadyAccepted && !agreed}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  flex:       { flex: 1 },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  title:      { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.md },
  reaccept:   { marginBottom: Spacing.md },
  agreeRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  checkbox:   { width: 24, height: 24, borderRadius: Radius.sm + 2, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  agreeText:  { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  error:      { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm, textAlign: 'center' },
  footer:     { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background },
});
