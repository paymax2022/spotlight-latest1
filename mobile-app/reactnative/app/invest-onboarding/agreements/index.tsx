import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import AgreementRow from '@/features/investonboarding/components/AgreementRow';
import { useAgreements, useAcceptAgreements } from '@/features/investonboarding/hooks/useOnboarding';

export default function AgreementsScreen() {
  const { data, isLoading, isError, refetch } = useAgreements();
  const accept = useAcceptAgreements();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setChecked((c) => ({ ...c, [id]: !c[id] }));

  const requiredIds = useMemo(() => (data ?? []).filter((a) => a.required).map((a) => a.id), [data]);
  const allRequiredChecked = requiredIds.length > 0 && requiredIds.every((id) => checked[id]);

  const acceptAll = () => {
    if (!data) return;
    const next: Record<string, boolean> = {};
    data.forEach((a) => { next[a.id] = true; });
    setChecked(next);
  };

  const onAccept = async () => {
    if (!data || !allRequiredChecked) return;
    const ids = data.filter((a) => checked[a.id]).map((a) => a.id);
    try {
      await accept.mutateAsync(ids);
      router.replace('/invest-onboarding/complete');
    } catch {
      /* error surfaced inline below */
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Agreements" />
        <StateView kind="loading" message="Loading agreements…" />
      </SafeAreaView>
    );
  }
  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Agreements" />
        <StateView kind="error" title="Couldn't load agreements" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Agreements"
        rightSlot={
          <Pressable onPress={acceptAll} hitSlop={8} accessibilityRole="button">
            <Text style={styles.acceptAll}>Accept all</Text>
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Please read and accept the required agreements to finish setting up your invest account.
        </Text>

        {data.map((a) => (
          <AgreementRow key={a.id} agreement={a} checked={!!checked[a.id]} onToggle={() => toggle(a.id)} />
        ))}

        {accept.isError ? (
          <Text style={styles.error}>{(accept.error as Error)?.message ?? 'Something went wrong. Please try again.'}</Text>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label="Accept & continue"
          onPress={onAccept}
          disabled={!allRequiredChecked}
          loading={accept.isPending}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  acceptAll: { ...Typography.labelMd, color: Colors.secondary },
  error: { ...Typography.labelSm, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
