import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { GraduationCap, Minus, Plus, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useOptInMentorship } from '@/features/connect/networking/mentorship/hooks';
import { MENTORSHIP_DOMAINS } from '@/features/connect/networking/mentorship/api';
import type { MentorshipRole } from '@/features/connect/networking/mentorship/types';

const ROLES: { key: MentorshipRole; label: string; blurb: string }[] = [
  { key: 'mentor', label: 'Mentor', blurb: 'Offer guidance to others' },
  { key: 'mentee', label: 'Mentee', blurb: 'Find a mentor to learn from' },
  { key: 'both', label: 'Both', blurb: 'Give and receive mentorship' },
];

/**
 * MN-01 — Mentorship opt-in. A self-service capability (PN-9, no approval gate):
 * pick a role, the domains you care about, and (for mentors) your capacity. This
 * is separate, explicit consent — it never derives from a Dating-mode profile (PN-7).
 */
export default function MentorshipOptInScreen() {
  const [role, setRole] = useState<MentorshipRole>('mentee');
  const [domains, setDomains] = useState<string[]>([]);
  const [capacity, setCapacity] = useState(2);
  const optIn = useOptInMentorship();

  const isMentor = role === 'mentor' || role === 'both';

  function toggleDomain(d: string) {
    setDomains((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function submit() {
    optIn.mutate(
      { role, domains, capacity: isMentor ? capacity : 0 },
      { onSuccess: () => router.replace('/connect/networking/mentorship/discovery') },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Mentorship" subtitle="Opt in to give or get guidance" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <View style={styles.introIcon}><GraduationCap size={24} color={ConnectColors.brand} strokeWidth={2} /></View>
          <Text style={styles.introBody}>
            Mentorship is a separate opt-in. Your professional details are used — never your dating profile.
          </Text>
        </View>

        <Text style={styles.label}>I want to be a…</Text>
        <View style={styles.roleRow}>
          {ROLES.map((r) => {
            const active = role === r.key;
            return (
              <Pressable key={r.key} onPress={() => setRole(r.key)} style={[styles.roleCard, active && styles.roleCardActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.roleLabel, active && styles.roleLabelActive]}>{r.label}</Text>
                <Text style={styles.roleBlurb}>{r.blurb}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Domains</Text>
        <View style={styles.chipWrap}>
          {MENTORSHIP_DOMAINS.map((d) => {
            const active = domains.includes(d);
            return (
              <Pressable key={d} onPress={() => toggleDomain(d)} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{d}</Text>
              </Pressable>
            );
          })}
        </View>

        {isMentor ? (
          <>
            <Text style={styles.label}>Capacity (concurrent mentees)</Text>
            <View style={styles.stepper}>
              <Pressable onPress={() => setCapacity((c) => Math.max(1, c - 1))} style={styles.stepBtn} accessibilityLabel="Decrease capacity">
                <Minus size={18} color={Colors.onSurface} />
              </Pressable>
              <Text style={styles.stepValue}>{capacity}</Text>
              <Pressable onPress={() => setCapacity((c) => Math.min(10, c + 1))} style={styles.stepBtn} accessibilityLabel="Increase capacity">
                <Plus size={18} color={Colors.onSurface} />
              </Pressable>
            </View>
          </>
        ) : null}

        <View style={styles.privacy}>
          <ShieldCheck size={14} color={Colors.teal} />
          <Text style={styles.privacyText}>Only your professional profile is shared in mentorship discovery.</Text>
        </View>

        {optIn.isError ? <Text style={styles.error}>Couldn't save your opt-in. Please try again.</Text> : null}
        <View style={{ height: Spacing.lg }} />
        <PrimaryButton
          label="Save & browse mentors"
          onPress={submit}
          loading={optIn.isPending}
          disabled={domains.length === 0}
        />
        <Pressable onPress={() => router.push('/connect/networking/mentorship/discovery')} style={styles.skip}>
          <Text style={styles.skipText}>Just browse mentors</Text>
        </Pressable>
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  intro: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center', marginBottom: Spacing.md },
  introIcon: { width: 48, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  introBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md, marginBottom: Spacing.xs },
  roleRow: { flexDirection: 'row', gap: Spacing.sm },
  roleCard: { flex: 1, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLowest },
  roleCardActive: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  roleLabel: { ...Typography.titleMd, color: Colors.onSurface },
  roleLabelActive: { color: ConnectColors.brand },
  roleBlurb: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8, backgroundColor: Colors.surfaceContainerLowest },
  chipActive: { backgroundColor: ConnectColors.brand, borderColor: ConnectColors.brand },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, alignSelf: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, padding: Spacing.xs },
  stepBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  stepValue: { ...Typography.headlineMd, color: Colors.onSurface, fontVariant: ['tabular-nums'], minWidth: 32, textAlign: 'center' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.lg, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  privacyText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1 },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  skip: { alignItems: 'center', paddingVertical: Spacing.md },
  skipText: { ...Typography.labelMd, color: ConnectColors.brand },
});
