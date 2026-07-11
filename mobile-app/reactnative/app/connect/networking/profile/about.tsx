import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useAbout, useUpdateAbout } from '@/features/connect/networking/profile/hooks';

const MAX_SUMMARY = 2000;

/** About summary — free-text professional summary (PRD §6.3 PR-09). */
export default function AboutScreen() {
  const query = useAbout();
  const update = useUpdateAbout();

  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (query.data && !hydrated) {
      setHeadline(query.data.headline ?? '');
      setSummary(query.data.summary ?? '');
      setHydrated(true);
    }
  }, [query.data, hydrated]);

  const canSave = summary.trim().length > 0 && !update.isPending;

  function onSave() {
    update.mutate(
      { headline: headline.trim() || undefined, summary: summary.trim() },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => router.back(), 900);
        },
      },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="About" />
      {query.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : query.isError ? (
        <StateView kind="error" icon="CloudOff" title="Couldn't load About" actionLabel="Retry" onAction={() => query.refetch()} />
      ) : saved ? (
        <StateView kind="empty" icon="CircleCheck" title="Saved" message="Your About summary has been updated." />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <TextInputField
              label="Headline"
              value={headline}
              onChangeText={setHeadline}
              placeholder="e.g. Product Engineer · Lagos"
              maxLength={120}
            />
            <TextInputField
              label="Professional summary"
              value={summary}
              onChangeText={setSummary}
              placeholder="Tell your professional story — what you do, what you care about, what you're looking for."
              multiline
              numberOfLines={10}
              maxLength={MAX_SUMMARY}
              style={styles.summaryInput}
            />
            <Text style={styles.counter}>{summary.trim().length}/{MAX_SUMMARY}</Text>

            <View style={styles.tip}>
              <CircleCheck size={15} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.tipText}>
                A fuller summary lifts your Profile Strength band. Aim for at least a couple of sentences.
              </Text>
            </View>

            {update.isError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>Couldn't save. Please try again.</Text>
              </View>
            ) : null}

            <View style={{ height: Spacing.xl }} />
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label="Save" onPress={onSave} loading={update.isPending} disabled={!canSave} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  summaryInput: { minHeight: 180, textAlignVertical: 'top' },
  counter: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'right', marginTop: -Spacing.sm },
  tip: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  tipText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  errorBox: { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  errorText: { ...Typography.labelMd, color: Colors.error },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
