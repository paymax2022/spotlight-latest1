import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Bell, Camera, Mic, MapPin, ShieldQuestion,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { PermissionPrimer, StateView } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePermissionStates, useRecordPermissionDecision } from '@/features/doctor/hooks';
import { PERMISSION_LABELS, PERMISSION_ORDER } from '@/features/doctor/constants';
import type { AppPermissionKind, PermissionState } from '@/types/doctor.onboarding';

// ── Section A · Entries 13–16 — One permission primer screen ─────────────────
// Parameterised by AppPermissionKind. Shows the rationale (PERMISSION_LABELS),
// then triggers a permission request and records the outcome via
// useRecordPermissionDecision. expo-av (microphone) / expo-location are NOT in
// package.json, so the OS prompt is SIMULATED via Alert for every kind (no new
// deps) and the decision is recorded the same way regardless.

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

const VALID_KINDS = new Set<AppPermissionKind>(PERMISSION_ORDER);

export default function PermissionPrimerScreen() {
  const { kind: rawKind } = useLocalSearchParams<{ kind: string }>();
  const kind = rawKind as AppPermissionKind;
  const valid = VALID_KINDS.has(kind);

  const { data: states, isLoading, isError, refetch } = usePermissionStates();
  const record = useRecordPermissionDecision();
  const [error, setError] = useState<string>();

  const current = (states?.permissions ?? []).find((p) => p.kind === kind);
  const currentState: PermissionState = current?.state ?? 'undetermined';

  const recordDecision = async (state: PermissionState) => {
    setError(undefined);
    try {
      await record.mutateAsync({ kind, state });
      router.back();
    } catch {
      setError('Could not record your decision. Please try again.');
    }
  };

  // Simulate the OS dialog (no native permission deps added) then record the
  // chosen outcome via the hook.
  const requestPermission = () => {
    if (!valid) return;
    const meta = PERMISSION_LABELS[kind];
    Alert.alert(
      `Allow ${meta.label}?`,
      meta.rationale,
      [
        { text: "Don't allow", style: 'cancel', onPress: () => recordDecision('denied') },
        { text: 'Allow', onPress: () => recordDecision('granted') },
      ],
    );
  };

  if (!valid) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Permission" />
        <StateView variant="empty" icon={ShieldQuestion} title="Unknown permission" message="This permission could not be found." />
      </SafeAreaView>
    );
  }

  const meta = PERMISSION_LABELS[kind];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TeleHeader title={meta.label} />

      {isLoading && !states ? (
        <StateView variant="loading" label="Loading" />
      ) : isError || !states ? (
        <StateView variant="error" message="We could not load this permission." onRetry={() => refetch()} />
      ) : (
        <View style={styles.flex}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <PermissionPrimer
              label={meta.label}
              rationale={meta.rationale}
              icon={ICON_MAP[kind]}
              required={meta.required}
              stateLabel={currentState !== 'undetermined' ? STATE_LABEL[currentState] : undefined}
              stateTone={STATE_TONE[currentState]}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={currentState === 'granted' ? 'Allowed — done' : 'Allow'}
              onPress={currentState === 'granted' ? () => router.back() : requestPermission}
              loading={record.isPending}
              style={styles.primaryBtn}
            />
            {currentState !== 'denied' && (
              <PrimaryButton
                label={meta.required ? "Not now" : 'Skip'}
                variant="ghost"
                onPress={() => recordDecision('denied')}
                disabled={record.isPending}
              />
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  flex:       { flex: 1 },
  content:    { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.lg },
  error:      { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.md, textAlign: 'center' },
  footer:     { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.xs },
  primaryBtn: { marginBottom: 0 },
});
