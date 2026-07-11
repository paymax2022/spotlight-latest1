import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Hourglass } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';

/**
 * SA-04 — Retry cooldown. After a FAILED attempt the backend returns a
 * `cooldownUntil` timestamp; we count down to it live. Retry is disabled until
 * the window elapses, then the CTA re-enables and routes back into the runner.
 */
export default function AssessmentCooldownScreen() {
  const { id, until } = useLocalSearchParams<{ id: string; until?: string }>();
  const assessmentId = String(id ?? '');
  const target = useMemo(() => (until ? new Date(String(until)).getTime() : Date.now()), [until]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remainingMs = Math.max(0, target - now);
  const ready = remainingMs <= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Retry cooldown" />
      <View style={styles.body}>
        <View style={styles.icon}><Hourglass size={34} color={Colors.onWarning} strokeWidth={2} /></View>
        <Text style={styles.title}>{ready ? 'You can retry now' : 'Cooling down'}</Text>
        <Text style={styles.sub}>
          {ready
            ? 'The cooldown has ended — you can take the assessment again.'
            : 'You can retake this assessment when the countdown reaches zero.'}
        </Text>

        {!ready ? (
          <>
            <Text style={styles.countdown} accessibilityLabel={`${formatCountdown(remainingMs)} remaining`}>
              {formatCountdown(remainingMs)}
            </Text>
            <Text style={styles.retryAt}>Retry available {new Date(target).toLocaleString()}</Text>
          </>
        ) : null}

        <View style={{ height: Spacing.xl }} />
        <PrimaryButton
          label={ready ? 'Retry assessment' : 'Retry locked'}
          disabled={!ready}
          onPress={() => router.replace(`/connect/networking/assessments/${encodeURIComponent(assessmentId)}/run`)}
        />
        <PrimaryButton label="Back to assessments" variant="ghost" onPress={() => router.replace('/connect/networking/assessments')} />
      </View>
    </SafeAreaView>
  );
}

// dd:hh:mm:ss (drops empty leading units) — tabular countdown.
function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  icon: {
    width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  countdown: { ...Typography.headlineMd, color: Colors.onWarning, fontVariant: ['tabular-nums'], fontWeight: '800', marginTop: Spacing.md },
  retryAt: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
