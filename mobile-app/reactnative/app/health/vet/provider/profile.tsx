import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CalendarClock, Wallet, Star, ChevronRight, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import { useProviderProfile, useUpdateProviderProfile } from '@/features/health/vet/hooks';
import { APPT_TYPE_OPTIONS } from '@/features/health/vet/constants';
import { formatNaira } from '@/features/health/constants/health.constants';
import type { AppointmentType } from '@/features/health/vet/types';

const SHORTCUTS = [
  { key: 'avail', label: 'Availability & calendar', icon: CalendarClock, href: '/health/vet/provider/availability' },
  { key: 'earn', label: 'Earnings & payouts', icon: Wallet, href: '/health/vet/provider/earnings' },
  { key: 'rev', label: 'Reviews', icon: Star, href: '/health/vet/provider/reviews' },
] as const;

export default function ProviderProfileScreen() {
  const { data: profile, isLoading, isError, refetch } = useProviderProfile();
  const update = useUpdateProviderProfile();

  const [bio, setBio] = useState('');
  const [consultFee, setConsultFee] = useState('');
  const [homeFee, setHomeFee] = useState('');
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (profile && !hydrated) {
      setBio(profile.bio);
      setConsultFee(String(profile.consultFeeKobo / 100));
      setHomeFee(String(profile.homeVisitFeeKobo / 100));
      setTypes(profile.types);
      setHydrated(true);
    }
  }, [profile, hydrated]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Profile & services" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Profile & services" />
        <StateView kind="error" title="Couldn't load profile" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const toggleType = (t: AppointmentType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const onSave = () =>
    update.mutate({
      bio: bio.trim(),
      consultFeeKobo: Math.round(Number(consultFee) * 100),
      homeVisitFeeKobo: Math.round(Number(homeFee) * 100),
      types,
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile & services" subtitle={profile.displayName} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, shadow1]}>
          <Text style={styles.name}>{profile.displayName}</Text>
          <Text style={styles.clinic}>{profile.clinicName}</Text>
          <CredentialBadge credential={profile.credential} showLicense />
        </View>

        <TextInputField label="Bio" placeholder="Tell pet owners about yourself" value={bio} onChangeText={setBio} multiline />

        <View style={styles.feeRow}>
          <View style={styles.feeCol}>
            <TextInputField label="Consult fee (₦)" placeholder="0" value={consultFee} onChangeText={setConsultFee} keyboardType="numeric" />
          </View>
          <View style={styles.feeCol}>
            <TextInputField label="Home visit fee (₦)" placeholder="0" value={homeFee} onChangeText={setHomeFee} keyboardType="numeric" />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Consult types offered</Text>
        <View style={styles.typeWrap}>
          {APPT_TYPE_OPTIONS.map((o) => {
            const active = types.includes(o.value);
            return (
              <Pressable key={o.value} style={[styles.typeChip, active && styles.typeChipActive]} onPress={() => toggleType(o.value)}>
                {active ? <Check size={14} color={Colors.secondary} strokeWidth={2.6} /> : null}
                <Text style={[styles.typeText, active && styles.typeTextActive]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <PrimaryButton label="Save changes" onPress={onSave} loading={update.isPending} variant="secondary" />

        <Text style={styles.sectionTitle}>Manage</Text>
        {SHORTCUTS.map((s) => (
          <Pressable key={s.key} style={[styles.shortcut, shadow1]} onPress={() => router.push(s.href)}>
            <s.icon size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.shortcutText}>{s.label}</Text>
            <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  clinic: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  feeRow: { flexDirection: 'row', gap: Spacing.sm },
  feeCol: { flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  typeChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  typeText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  typeTextActive: { color: Colors.secondary },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  shortcutText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
