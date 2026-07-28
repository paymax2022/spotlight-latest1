import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Volume2, X, Star, PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { useEcceHome } from '@/features/academy/hooks';

/**
 * E2 — Play-learn activity (phonics / numeracy / shapes / colors). Audio-led
 * (speaker icon is the TTS placeholder), big tappable answers, gentle feedback.
 * No text-heavy UI; screen-light by design.
 */
export default function EccePlay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const home = useEcceHome();
  const [roundIdx, setRoundIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  if (home.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  const activity = home.data?.activities.find((a) => a.id === id);
  if (!activity) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Let’s try again" /></SafeAreaView>;

  const round = activity.rounds[roundIdx];
  const stars = Math.max(1, Math.round((score / activity.rounds.length) * 3));

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.done}>
          <PartyPopper size={56} color={Colors.gold} />
          <Text style={styles.doneTitle}>Yay! Well done!</Text>
          <View style={styles.starsBig}>
            {[0, 1, 2].map((i) => <Star key={i} size={40} color={Colors.gold} fill={i < stars ? Colors.gold : 'transparent'} />)}
          </View>
          <Pressable style={styles.bigBtn} onPress={() => router.replace('/learn/academy/ecce')}>
            <Text style={styles.bigBtnText}>Back to play</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const pick = (optId: string, correct: boolean) => {
    if (picked) return;
    setPicked(optId);
    if (correct) setScore((s) => s + 1);
    setTimeout(() => {
      setPicked(null);
      if (roundIdx + 1 < activity.rounds.length) setRoundIdx((i) => i + 1);
      else setDone(true);
    }, 900);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Close (exit) — large target, top-left */}
      <View style={styles.header}>
        <Pressable style={styles.close} accessibilityLabel="Close" onPress={() => router.replace('/learn/academy/ecce')}>
          <X size={24} color={Colors.onSurfaceVariant} />
        </Pressable>
        <Text style={styles.progress}>{roundIdx + 1} / {activity.rounds.length}</Text>
      </View>

      <View style={styles.body}>
        {/* Audio-led prompt */}
        <Pressable style={[styles.speaker, shadow3]} accessibilityLabel="Hear the question" onPress={() => { /* TTS placeholder */ }}>
          <Volume2 size={36} color={Colors.onPrimary} />
        </Pressable>
        <Text style={styles.prompt}>{round.say}</Text>

        {/* Big tappable answers */}
        <View style={styles.options}>
          {round.options.map((o) => {
            const isPicked = picked === o.id;
            const reveal = picked != null;
            const showCorrect = reveal && o.correct;
            const showWrong = isPicked && !o.correct;
            return (
              <Pressable
                key={o.id}
                style={[styles.option, shadow1, showCorrect && styles.optionCorrect, showWrong && styles.optionWrong]}
                accessibilityLabel={o.label}
                onPress={() => pick(o.id, o.correct)}
              >
                <Text style={styles.optionEmoji}>{o.emoji}</Text>
                <Text style={styles.optionLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  close: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  progress: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.lg },
  speaker: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  prompt: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.md, marginTop: Spacing.md },
  option: { width: '42%', aspectRatio: 1, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 2, borderColor: 'transparent' },
  optionCorrect: { borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  optionWrong: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  optionEmoji: { fontSize: 52 },
  optionLabel: { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '700' },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  starsBig: { flexDirection: 'row', gap: Spacing.sm },
  bigBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxl },
  bigBtnText: { ...Typography.labelLg, color: Colors.onPrimary },
});
