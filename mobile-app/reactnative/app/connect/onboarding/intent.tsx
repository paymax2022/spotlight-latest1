import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Heart, Briefcase, Compass, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import { useSaveOnboardingDraft } from '@/features/connect/hooks/useConnect';
import type { ConnectIntent } from '@/features/connect/types/connect.types';

// ON-06 — Intent selection. Choose mode(s): Date / Network / Discover.
const OPTIONS: { value: ConnectIntent; icon: typeof Heart; title: string; body: string }[] = [
  { value: 'date', icon: Heart, title: 'Dating', body: 'Meet someone special. Romantic intent stays private.' },
  { value: 'network', icon: Briefcase, title: 'Networking', body: 'Professional and interest-based connections.' },
  { value: 'discover', icon: Compass, title: 'Discover', body: 'Explore live streams, events and trending creators.' },
];

export default function Intent() {
  const [selected, setSelected] = useState<ConnectIntent[]>([]);
  const save = useSaveOnboardingDraft();

  const toggle = (v: ConnectIntent) =>
    setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const onNext = () => {
    save.mutate(
      { intents: selected },
      { onSuccess: () => router.push('/connect/onboarding/profile-basics') },
    );
  };

  return (
    <OnboardingStep
      step={1}
      totalSteps={8}
      title="What brings you to Connect?"
      subtitle="Pick one or more. You can switch modes anytime — each has its own visibility."
      primaryLabel="Continue"
      onPrimary={onNext}
      primaryDisabled={selected.length === 0}
      primaryLoading={save.isPending}
    >
      {OPTIONS.map((o) => {
        const active = selected.includes(o.value);
        const Icon = o.icon;
        return (
          <Pressable
            key={o.value}
            style={[styles.card, active && styles.cardActive]}
            onPress={() => toggle(o.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            accessibilityLabel={o.title}
          >
            <View style={[styles.iconBox, active && styles.iconBoxActive]}>
              <Icon size={22} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title}>{o.title}</Text>
              <Text style={styles.sub}>{o.body}</Text>
            </View>
            <View style={[styles.check, active && styles.checkActive]}>
              {active ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
            </View>
          </Pressable>
        );
      })}
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  cardActive: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  iconBox: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  iconBoxActive: { backgroundColor: Colors.primary },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  check: {
    width: 24, height: 24, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  checkActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
