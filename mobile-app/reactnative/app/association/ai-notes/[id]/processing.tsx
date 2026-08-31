import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { awaitProcessing } from '@/features/association/api/ainotes.api';

const STEPS = ['Transcribing audio', 'Summarising discussion', 'Extracting decisions', 'Extracting action items', 'Identifying attendance'];

const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS   = 30_000;
const MAX_CONSECUTIVE_ERRORS = 3;

export default function AiProcessing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [step, setStep] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => { setTimedOut(false); setAttempt((a) => a + 1); }, []);

  useEffect(() => {
    // Advance the visible step every ~450ms for feedback.
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 450);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errors = 0;
    const deadline = Date.now() + POLL_BUDGET_MS;

    // A note is created in PROCESSING, so a single GET always saw a non-READY
    // status and routed straight to the error edge screen. Poll until the note
    // settles, the budget runs out, or the server keeps failing.
    const poll = async () => {
      try {
        const res = await awaitProcessing(id as string);
        if (cancelled) return;
        errors = 0;
        if (res.status === 'READY' || res.status === 'APPROVED' || res.status === 'PUBLISHED') {
          router.replace(`/association/ai-notes/${id}`);
          return;
        }
        if (res.status === 'FAILED') { router.replace('/association/edge/error'); return; }
      } catch {
        if (cancelled) return;
        errors += 1;
        if (errors >= MAX_CONSECUTIVE_ERRORS) { router.replace('/association/edge/error'); return; }
      }
      if (Date.now() >= deadline) { setTimedOut(true); return; }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();

    return () => { cancelled = true; clearInterval(ticker); if (timer) clearTimeout(timer); };
  }, [id, attempt]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}>
          <Sparkles size={34} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>{timedOut ? 'Still processing' : 'Processing your meeting'}</Text>
        <Text style={styles.sub}>
          {timedOut
            ? 'This recording is taking longer than usual. It keeps processing in the background — we’ll notify you when the minutes are ready.'
            : 'This usually takes a moment. You can leave — we’ll notify you when it’s ready.'}
        </Text>

        {timedOut ? (
          <View style={styles.actions}>
            <PrimaryButton label="Check again" onPress={retry} />
            <PrimaryButton label="Back to minutes" variant="secondary" onPress={() => router.replace('/association/ai-notes')} />
          </View>
        ) : null}

        <View style={styles.steps}>
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <View key={label} style={styles.stepRow}>
                <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
                  {done ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : active ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
                </View>
                <Text style={[styles.stepLabel, (done || active) && styles.stepLabelOn]}>{label}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.sm },
  steps: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepDot: { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.primary },
  stepDotDone: { backgroundColor: Colors.primary },
  stepLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stepLabelOn: { color: Colors.onSurface, fontWeight: '600' as const },
});
