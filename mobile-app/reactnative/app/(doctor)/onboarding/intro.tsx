import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Stethoscope, CalendarCheck, Wallet, ShieldCheck, HeartPulse, Sparkles,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { OnboardingSlidePager, StateView } from '@/features/doctor/components';
import type { PagerSlide } from '@/features/doctor/components';
import { useOnboardingSlides } from '@/features/doctor/hooks';

// ── Section A · Entry 2 — App intro carousel ─────────────────────────────────
// Paged slides from useOnboardingSlides with dots + skip/next/get-started.
// Maps the contract's Ionicons name to a lucide icon (the rest of the app uses
// lucide); falls back to Sparkles for any unmapped name.

const ICON_MAP: Record<string, LucideIcon> = {
  'medkit-outline':        Stethoscope,
  'pulse-outline':         HeartPulse,
  'calendar-outline':      CalendarCheck,
  'wallet-outline':        Wallet,
  'shield-checkmark-outline': ShieldCheck,
  'shield-outline':        ShieldCheck,
};

export default function OnboardingIntroScreen() {
  const { data: slides, isLoading, isError, refetch } = useOnboardingSlides();
  const [index, setIndex] = useState(0);

  const pagerSlides: PagerSlide[] = useMemo(
    () => (slides ?? []).map((s) => ({ id: s.id, title: s.title, body: s.body, icon: ICON_MAP[s.icon] ?? Sparkles })),
    [slides],
  );

  const isLast = index >= pagerSlides.length - 1;

  const finish = () => router.push('/(doctor)/onboarding/upgrade-merchant');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TeleHeader title="Welcome" right={<Pressable onPress={finish} accessibilityRole="button"><Text style={styles.skip}>Skip</Text></Pressable>} />

      {isLoading && !slides ? (
        <StateView variant="loading" label="Loading" />
      ) : isError || !slides ? (
        <StateView variant="error" message="We could not load the intro." onRetry={() => refetch()} />
      ) : pagerSlides.length === 0 ? (
        <StateView variant="empty" icon={Sparkles} title="Nothing to show" message="Continue to set up your practice." />
      ) : (
        <View style={styles.flex}>
          <OnboardingSlidePager slides={pagerSlides} activeIndex={index} onIndexChange={setIndex} />
          <View style={styles.footer}>
            <PrimaryButton
              label={isLast ? 'Get started' : 'Next'}
              onPress={isLast ? finish : () => setIndex((i) => Math.min(i + 1, pagerSlides.length - 1))}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  flex:   { flex: 1 },
  skip:   { ...Typography.labelMd, color: Colors.secondary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
});
