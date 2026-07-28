import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Bell, Camera, Mic, MapPin, ChevronRight, ShieldQuestion, KeyRound,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, StatusBadge } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePermissionStates } from '@/features/doctor/hooks';
import { PERMISSION_ORDER, PERMISSION_LABELS } from '@/features/doctor/constants';
import type { AppPermissionKind, PermissionState } from '@/types/doctor.onboarding';

// ── Section A · Entries 13–16 (hub) — Permission primer checklist ────────────
// Reads usePermissionStates (always four kinds; an "empty" permission is
// undetermined). Each row deep links to the single permission primer screen.
// When every required permission is decided, routes into the profile builder
// matching the persisted provider type.

const ICON_MAP: Record<AppPermissionKind, LucideIcon> = {
  notification: Bell,
  camera:       Camera,
  microphone:   Mic,
  location:     MapPin,
};

const STATE_TONE: Record<PermissionState, StatusTone> = {
  granted:      'success',
  denied:       'danger',
  undetermined: 'neutral',
};

const STATE_LABEL: Record<PermissionState, string> = {
  granted:      'Granted',
  denied:       'Denied',
  undetermined: 'Not set',
};

export default function PermissionsHubScreen() {
  const { data: states, isLoading, isError, refetch } = usePermissionStates();

  const byKind = new Map((states?.permissions ?? []).map((p) => [p.kind, p]));
  const requiredKinds = PERMISSION_ORDER.filter((k) => PERMISSION_LABELS[k].required);
  const decidedRequired = requiredKinds.filter((k) => (byKind.get(k)?.state ?? 'undetermined') !== 'undetermined');
  const allRequiredDecided = decidedRequired.length === requiredKinds.length;
  const decidedCount = PERMISSION_ORDER.filter((k) => (byKind.get(k)?.state ?? 'undetermined') !== 'undetermined').length;

  // Hand off to the builder intro (entries 5/6/7), which reads the persisted
  // provider type and forwards into the correct existing builder.
  const goToBuilder = () => router.push('/(doctor)/onboarding/builder');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Permissions" />

      {isLoading && !states ? (
        <StateView variant="loading" label="Loading permissions" />
      ) : isError || !states ? (
        <StateView variant="error" message="We could not load permissions." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <KeyRound size={28} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.introTitle}>Enable device permissions</Text>
            <Text style={styles.introSub}>Camera and microphone are required for video consultations. Notifications and location are recommended.</Text>
          </View>

          <WizardProgress current={decidedCount} total={PERMISSION_ORDER.length} label={`${decidedCount}/${PERMISSION_ORDER.length} decided`} />

          <SectionCard title="App permissions" style={styles.card}>
            {PERMISSION_ORDER.map((kind: AppPermissionKind, i) => {
              const Icon = ICON_MAP[kind];
              const meta = PERMISSION_LABELS[kind];
              const state = byKind.get(kind)?.state ?? 'undetermined';
              return (
                <Pressable
                  key={kind}
                  onPress={() => router.push(`/(doctor)/onboarding/permissions/${kind}`)}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  accessibilityRole="button"
                  accessibilityLabel={meta.label}
                >
                  <View style={styles.rowIcon}>
                    <Icon size={20} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{meta.label}</Text>
                    <Text style={styles.rowMeta}>{meta.required ? 'Required' : 'Recommended'}</Text>
                  </View>
                  <StatusBadge label={STATE_LABEL[state]} tone={STATE_TONE[state]} />
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </Pressable>
              );
            })}
          </SectionCard>

          {!allRequiredDecided && (
            <View style={styles.note}>
              <ShieldQuestion size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.noteText}>Decide on the required permissions to continue to your profile.</Text>
            </View>
          )}

          <PrimaryButton
            label={allRequiredDecided ? 'Continue to profile builder' : 'Review required permissions'}
            onPress={allRequiredDecided ? goToBuilder : () => router.push(`/(doctor)/onboarding/permissions/${requiredKinds[0] ?? PERMISSION_ORDER[0]}`)}
            style={styles.btn}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:  { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  introSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:       { marginBottom: Spacing.md },
  row:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rowBorder:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  rowIcon:    { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowBody:    { flex: 1, gap: 2 },
  rowLabel:   { ...Typography.bodyMd, color: Colors.onSurface },
  rowMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  note:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgBlue, marginBottom: Spacing.md },
  noteText:   { ...Typography.caption, color: Colors.secondary, flex: 1 },
  btn:        { marginTop: Spacing.xs },
});
