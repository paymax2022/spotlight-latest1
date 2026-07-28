import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { awaitProcessing } from '@/features/association/api/ainotes.api';

const STEPS = ['Transcribing audio', 'Summarising discussion', 'Extracting decisions', 'Extracting action items', 'Identifying attendance'];

export default function AiProcessing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Advance the visible step every ~450ms for feedback.
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 450);
    let cancelled = false;
    awaitProcessing(id as string)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'READY') router.replace(`/association/ai-notes/${id}`);
        else router.replace('/association/edge/error');
      })
      .catch(() => { if (!cancelled) router.replace('/association/edge/error'); });
    return () => { cancelled = true; clearInterval(ticker); };
  }, [id]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}>
          <Sparkles size={34} color={Colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.title}>Processing your meeting</Text>
        <Text style={styles.sub}>This usually takes a moment. You can leave — we’ll notify you when it’s ready.</Text>

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
  steps: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepDot: { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.primary },
  stepDotDone: { backgroundColor: Colors.primary },
  stepLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stepLabelOn: { color: Colors.onSurface, fontWeight: '600' as const },
});
