import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StepHeader from '@/features/investonboarding/components/StepHeader';
import { useSubmitKyc } from '@/features/investonboarding/hooks/useOnboarding';
import { kycDraft } from '@/features/investonboarding/utils/onboardingDraft';
import { ID_DOC_TYPES, KYC_PRIVACY_NOTE } from '@/features/investonboarding/constants/onboarding.constants';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export default function KycReviewScreen() {
  const d = kycDraft.current;
  const submit = useSubmitKyc();
  const docLabel = ID_DOC_TYPES.find((t) => t.value === d.idDocType)?.label ?? d.idDocType;

  const onSubmit = async () => {
    try {
      await submit.mutateAsync(d);
      router.replace('/invest-onboarding/kyc/submitted');
    } catch {
      /* error surfaced inline below */
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review & submit" />
      <StepHeader step={4} total={4} label="Review" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Personal details</Text>
          <Row label="Name" value={`${d.personal.firstName} ${d.personal.lastName}`.trim() || '—'} />
          <View style={styles.divider} />
          <Row label="Date of birth" value={d.personal.dob || '—'} />
          <View style={styles.divider} />
          <Row label="BVN" value={d.personal.bvn ? `••• ${d.personal.bvn.slice(-4)}` : '—'} />
          <View style={styles.divider} />
          <Row label="NIN" value={d.personal.nin ? `••• ${d.personal.nin.slice(-4)}` : '—'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Documents</Text>
          <Row label="ID type" value={docLabel} />
          <View style={styles.divider} />
          <View style={styles.checkRow}>
            <CircleCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.checkText}>ID document uploaded</Text>
          </View>
          <View style={styles.checkRow}>
            <CircleCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.checkText}>Selfie / liveness captured</Text>
          </View>
        </View>

        <Text style={styles.privacy}>{KYC_PRIVACY_NOTE}</Text>

        {submit.isError ? (
          <Text style={styles.error}>{(submit.error as Error)?.message ?? 'Submission failed. Please try again.'}</Text>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit for verification" onPress={onSubmit} loading={submit.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.xs,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs, gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  checkText: { ...Typography.bodyMd, color: Colors.onSurface },
  privacy: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  error: { ...Typography.labelSm, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
