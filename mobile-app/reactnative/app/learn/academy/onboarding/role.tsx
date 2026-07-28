import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { GraduationCap, Users, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useSetRole } from '@/features/academy/hooks';
import type { AcademyRole } from '@/features/academy/types';

const ROLES: { value: AcademyRole; title: string; sub: string; icon: typeof GraduationCap }[] = [
  { value: 'learner', title: 'I’m a Learner', sub: 'Study, take mocks and earn rewards', icon: GraduationCap },
  { value: 'parent', title: 'I’m a Parent / Guardian', sub: 'Track and support my child', icon: Users },
];

/** A5 — Role selection (additive). Reuses Paymax SSO conceptually; role is mocked. */
export default function RoleSelectScreen() {
  const [role, setRole] = useState<AcademyRole>('learner');
  const setRoleMut = useSetRole();

  const next = () => {
    setRoleMut.mutate(role, {
      onSettled: () => router.push('/learn/academy/onboarding/age'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Welcome to Spotlight Academy" subtitle="Step 1 of 4 · Who are you?" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.lead}>Spotlight Academy is one app for the whole family. Pick how you’ll use it — you can add the other role later.</Text>
        {ROLES.map((r) => {
          const active = role === r.value;
          const Icon = r.icon;
          return (
            <Pressable
              key={r.value}
              onPress={() => setRole(r.value)}
              style={[styles.card, shadow1, active && styles.cardActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.iconBox, active && styles.iconBoxActive]}>
                <Icon size={24} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{r.title}</Text>
                <Text style={styles.cardSub}>{r.sub}</Text>
              </View>
              {active ? <Check size={20} color={Colors.primary} strokeWidth={2.5} /> : <View style={styles.radio} />}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} loading={setRoleMut.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  lead: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.cardPadding, borderWidth: 1.5, borderColor: Colors.transparent,
  },
  cardActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  iconBox: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  iconBoxActive: { backgroundColor: Colors.primary },
  cardText: { flex: 1 },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.outlineVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
