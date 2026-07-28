import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Mic, Video, Wifi } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConsultLobbyCard, EmergencyBanner } from '@/features/health/components';
import { useConsult } from '@/features/health/hooks';

const CHECKS = [
  { icon: Wifi, label: 'Connection', value: 'Stable' },
  { icon: Mic, label: 'Microphone', value: 'Ready' },
  { icon: Video, label: 'Camera', value: 'Ready' },
];

export default function ConsultLobbyScreen() {
  const { consultId } = useLocalSearchParams<{ consultId: string }>();
  const { data: consult, isLoading, isError, refetch } = useConsult(consultId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Consult lobby" />

      {isLoading ? (
        <StateView kind="loading" message="Joining the lobby…" />
      ) : isError || !consult ? (
        <StateView kind="error" title="Consult unavailable" message="We couldn't load this consult." actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <ConsultLobbyCard consult={consult} />

            {/* Device readiness checks */}
            <View style={styles.checks}>
              <Text style={styles.checksTitle}>Before you join</Text>
              {CHECKS.map(({ icon: Icon, label, value }) => (
                <View key={label} style={styles.checkRow}>
                  <View style={styles.checkIcon}>
                    <Icon size={16} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <Text style={styles.checkLabel}>{label}</Text>
                  <Text style={styles.checkValue}>{value}</Text>
                </View>
              ))}
            </View>

            <EmergencyBanner />
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={consult.providerReady ? 'Join consult' : 'Waiting for provider…'}
              disabled={!consult.providerReady}
              onPress={() => router.push({ pathname: '/health/consult/room', params: { consultId: consult.id } })}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  checks: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  checksTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface, marginBottom: Spacing.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkIcon: { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  checkValue: { ...Typography.labelMd, color: Colors.teal },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
