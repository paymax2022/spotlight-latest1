import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, ChevronRight, FileText, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useConsentStatus } from '@/features/doctor/hooks';
import { LEGAL_DOC_ORDER, LEGAL_DOC_LABELS } from '@/features/doctor/constants';
import type { LegalDocKind } from '@/types/doctor.onboarding';

// ── Section A · Entries 8–12 (hub) — Legal consent checklist ─────────────────
// Reads useConsentStatus and renders the five required documents. Each row deep
// links into the single versioned consent screen. When all accepted (empty
// outstanding / allAccepted), routes onward to the permissions gate.

export default function ConsentsHubScreen() {
  const { data: status, isLoading, isError, refetch } = useConsentStatus();

  const acceptedKinds = new Set((status?.accepted ?? []).map((r) => r.kind));
  const acceptedCount = LEGAL_DOC_ORDER.filter((k) => acceptedKinds.has(k)).length;
  const total = LEGAL_DOC_ORDER.length;
  const allAccepted = status?.allAccepted ?? false;

  const goNext = () => router.push('/(doctor)/onboarding/permissions');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Agreements" />

      {isLoading && !status ? (
        <StateView variant="loading" label="Loading agreements" />
      ) : isError || !status ? (
        <StateView variant="error" message="We could not load your agreements." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <ShieldCheck size={28} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.introTitle}>Review & accept your agreements</Text>
            <Text style={styles.introSub}>You must accept all required documents before you can practise. Demo legal copy.</Text>
          </View>

          <WizardProgress current={acceptedCount} total={total} label={`${acceptedCount}/${total} accepted`} />

          {allAccepted && (
            <View style={styles.doneBanner}>
              <Check size={18} color={Colors.teal} strokeWidth={2.4} />
              <Text style={styles.doneText}>All agreements accepted. You're good to go.</Text>
            </View>
          )}

          <SectionCard title="Required agreements" style={styles.card}>
            {LEGAL_DOC_ORDER.map((kind: LegalDocKind, i) => {
              const done = acceptedKinds.has(kind);
              return (
                <Pressable
                  key={kind}
                  onPress={() => router.push(`/(doctor)/onboarding/consent/${kind}`)}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  accessibilityRole="button"
                  accessibilityLabel={LEGAL_DOC_LABELS[kind]}
                >
                  <View style={[styles.rowIcon, done && styles.rowIconDone]}>
                    {done ? <Check size={16} color={Colors.onPrimary} strokeWidth={3} /> : <FileText size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{LEGAL_DOC_LABELS[kind]}</Text>
                    <Text style={styles.rowMeta}>{done ? 'Accepted' : 'Tap to review'}</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </Pressable>
              );
            })}
          </SectionCard>

          <PrimaryButton
            label={allAccepted ? 'Continue to permissions' : 'Review agreements'}
            onPress={allAccepted ? goNext : () => router.push(`/(doctor)/onboarding/consent/${(status.outstanding[0] ?? LEGAL_DOC_ORDER[0])}`)}
            disabled={!allAccepted && status.outstanding.length === 0}
            style={styles.btn}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:       { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:   { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle:  { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  introSub:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  doneBanner:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgTeal, marginBottom: Spacing.md },
  doneText:    { ...Typography.labelMd, color: Colors.teal, flex: 1 },
  card:        { marginBottom: Spacing.md },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  rowIcon:     { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  rowIconDone: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rowBody:     { flex: 1, gap: 2 },
  rowLabel:    { ...Typography.bodyMd, color: Colors.onSurface },
  rowMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  btn:         { marginTop: Spacing.xs },
});
