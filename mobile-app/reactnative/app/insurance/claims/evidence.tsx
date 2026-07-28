import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { useClaim, useUploadEvidence } from '@/features/insurance/claims';
import EvidencePicker from '@/features/insurance/components/claims-EvidencePicker';

/** Evidence upload (PRD §15.1) — image picker + signed-url placeholder. */
export default function ClaimEvidence() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const claim = useClaim(id ?? '');
  const upload = useUploadEvidence(id ?? '');

  if (claim.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Add evidence" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (claim.isError || !claim.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Add evidence" />
        <StateView kind="error" title="Couldn't load claim" actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const c = claim.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add evidence" subtitle={c.policyName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Add photos or documents that support your claim. Files upload over a secure, time-limited link.
        </Text>

        <EvidencePicker
          evidence={c.evidence}
          uploading={upload.isPending}
          onPick={(file) => upload.mutate(file)}
        />

        {upload.isError ? <Text style={styles.err}>Upload failed. Please try again.</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit & track claim" onPress={() => router.replace(`/insurance/claims/status?id=${c.id}`)} />
        <Text style={styles.skip} onPress={() => router.replace(`/insurance/claims/status?id=${c.id}`)}>
          I'll add evidence later
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 24, gap: Spacing.md },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  err: { ...Typography.labelSm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.sm },
  skip: { ...Typography.labelLg, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
