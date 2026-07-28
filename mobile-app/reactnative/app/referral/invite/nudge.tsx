import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { useNudgeInvitee } from '@/features/referral/invite/hooks';
import type { NudgeResult } from '@/features/referral/invite/types';

// M-INV-08 — Nudge a pending invitee (gentle reminder to a friend who hasn't activated).
const PRESETS = [
  'Hey! Still keen to try Paymax? It only takes a minute to verify and send your first transaction.',
  'No pressure — but once you make a real transaction we both unlock a reward. Here when you are ready!',
  'Quick reminder: finish setting up Paymax whenever it suits you.',
];

const ERROR_COPY: Record<NonNullable<NudgeResult['error']>, string> = {
  rate_limited: 'You have already nudged recently. Give it a little time before sending another.',
  opted_out: 'This friend opted out of reminders, so we cannot nudge them.',
  already_activated: 'Good news — this friend is already activated!',
};

export default function NudgeScreen() {
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const id = params.id ?? '';
  const name = params.name ?? 'your friend';
  const nudge = useNudgeInvitee();
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<NudgeResult | null>(null);

  if (!id) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Nudge" />
        <StateView kind="error" title="Nothing to nudge" message="Open this from an invitee in your tracking list." actionLabel="Go to tracking" onAction={() => router.replace('/referral/invite/tracking')} />
      </SafeAreaView>
    );
  }

  if (result?.ok) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Nudge sent" />
        <StateView kind="empty" icon="CircleCheck" title="Reminder sent" message={`We sent a friendly reminder to ${name}.`} actionLabel="Back to tracking" onAction={() => router.replace('/referral/invite/tracking')} />
      </SafeAreaView>
    );
  }

  const onSend = () => nudge.mutate(id, { onSuccess: setResult });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Nudge ${name}`} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}><Bell size={22} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.title}>Send a friendly reminder</Text>
          <Text style={styles.body}>Pick a message. We keep nudges gentle and rate-limited — no spam, no pressure.</Text>
        </View>

        {result && !result.ok && result.error && (
          <DisclosureCard tone={result.error === 'already_activated' ? 'compliant' : 'warn'} body={ERROR_COPY[result.error]} />
        )}

        <View style={{ gap: Spacing.sm }}>
          {PRESETS.map((p, i) => (
            <Pressable key={i} style={[styles.option, selected === i && styles.optionOn]} onPress={() => setSelected(i)} accessibilityRole="radio" accessibilityState={{ selected: selected === i }}>
              <View style={[styles.radio, selected === i && styles.radioOn]} />
              <Text style={styles.optionText}>{p}</Text>
            </Pressable>
          ))}
        </View>

        <DisclosureCard tone="info" body="Remember: a nudge cannot create earnings. You only earn when your friend genuinely verifies and transacts." />

        <PrimaryButton label="Send nudge" onPress={onSend} loading={nudge.isPending} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  iconWrap: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  optionOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryContainer },
  radio: { width: 20, height: 20, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outline, marginTop: 2 },
  radioOn: { borderColor: Colors.primary, borderWidth: 6 },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
