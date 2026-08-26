import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { usePartnerClaim, useUploadInspection } from '@/features/insurance/partner';
import EvidencePicker from '@/features/insurance/components/claims-EvidencePicker';

/** Partner/driver: inspection upload (PRD §15.3) — remote inspection photos. */
export default function PartnerInspectionUpload() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const claim = usePartnerClaim(id ?? '');
  const upload = useUploadInspection(id ?? '');

  if (claim.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Inspection" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (claim.isError || !claim.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Inspection" />
        <StateView kind="error" title="Couldn't load claim" actionLabel="Back" onAction={() => goBack('/insurance')} />
      </SafeAreaView>
    );
  }

  const c = claim.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Inspection" subtitle={c.policyName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Add clear photos of the damage from multiple angles. Remote inspection speeds up your fast-track motor claim.
        </Text>

        <EvidencePicker
          evidence={c.evidence}
          uploading={upload.isPending}
          kindLabel="inspection"
          onPick={(file) => upload.mutate({ label: file.label, uri: file.uri })}
        />

        {upload.isError ? <Text style={styles.err}>Upload failed. Please try again.</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit & track claim" onPress={() => router.replace(`/insurance/partner/claim-status?id=${c.id}`)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 24, gap: Spacing.md },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  err: { ...Typography.labelSm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
