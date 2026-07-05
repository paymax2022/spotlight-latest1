import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Gamepad2, Timer, CheckCircle2, Circle, XCircle, Flame, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import RoundVideoCard from '@/features/arena/components/RoundVideoCard';
import { usePlayAlongQuestions, useSubmitPlayAlong } from '@/features/arena/hooks';
import { PLAYALONG_ROUNDS, NDC1_MERIT_NOTE } from '@/features/arena/constants';
import { newIdempotencyKey } from '@/features/arena/api';

const PER_QUESTION_SECS = 20;
const BASE_POINTS = 100;

const ROUND_OPTIONS = PLAYALONG_ROUNDS.map((r) => ({ value: String(r.round), label: r.label }));

/**
 * S2 — "Are You a Naija Driver?" Play-Along quiz, organised into three
 * categorised rounds. Each round opens with an (admin-updatable) lesson video,
 * then a gamified quiz: instant right/wrong reveal, points, and a streak
 * multiplier. ENGAGEMENT only — an attempt never affects Merit (NDC-1).
 */
export default function QuizScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';

  const [roundNo, setRoundNo] = useState(1);
  const round = useMemo(() => PLAYALONG_ROUNDS.find((r) => r.round === roundNo) ?? PLAYALONG_ROUNDS[0], [roundNo]);
  const category = round.category;

  const [started, setStarted] = useState(false);
  const q = usePlayAlongQuestions(competitionId, category);
  const submit = useSubmitPlayAlong();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secs, setSecs] = useState(PER_QUESTION_SECS);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());

  // Gamification
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [lastPoints, setLastPoints] = useState(0);

  const questions = q.data ?? [];
  const current = questions[index];
  const gamified = !!current?.correctOptionId; // mock provides answers → instant feedback

  // Per-question countdown; pauses on reveal, auto-times-out otherwise.
  useEffect(() => {
    if (!started || !current || revealed) return;
    setSecs(current.timeLimitSecs ?? PER_QUESTION_SECS);
    const id = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) { clearInterval(id); handleTimeout(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, started, current?.id, revealed]);

  const handleTimeout = () => {
    if (gamified && !revealed) { setStreak(0); setLastPoints(0); setRevealed(true); }
    else if (!gamified) advance();
  };

  const pick = (qid: string, oid: string) => {
    if (revealed) return; // locked after reveal
    setAnswers((a) => ({ ...a, [qid]: oid }));
    if (!gamified || !current) return;
    const correct = oid === current.correctOptionId;
    if (correct) {
      const pts = BASE_POINTS + secs * 5 + streak * 10; // time bonus + streak multiplier
      setLastPoints(pts);
      setScore((s) => s + pts);
      setCorrectCount((c) => c + 1);
      setStreak((st) => { const next = st + 1; setBestStreak((b) => Math.max(b, next)); return next; });
    } else {
      setLastPoints(0);
      setStreak(0);
    }
    setRevealed(true);
  };

  const advance = () => {
    setRevealed(false);
    if (index < questions.length - 1) setIndex((i) => i + 1);
    else finish();
  };

  const finish = () => {
    const total = questions.length;
    const passed = total > 0 && correctCount / total >= 0.6;
    const goResults = () =>
      router.replace({
        pathname: '/arena/quiz-results',
        params: {
          competitionId,
          round: String(roundNo),
          score: String(correctCount),
          total: String(total),
          points: String(score),
          bestStreak: String(bestStreak),
          passed: passed ? '1' : '0',
        },
      });
    submit.mutate(
      {
        competitionId,
        category,
        idempotencyKey: idemKey,
        answers: Object.entries(answers).map(([questionId, optionId]) => ({ questionId, optionId })),
      },
      // Engagement recording is best-effort; the gamified result still shows.
      { onSuccess: goResults, onError: goResults },
    );
  };

  const startRound = () => {
    setIndex(0); setAnswers({}); setScore(0); setStreak(0); setBestStreak(0);
    setCorrectCount(0); setRevealed(false); setLastPoints(0);
    setIdemKey(newIdempotencyKey());
    setStarted(true);
  };

  const answered = useMemo(() => Object.keys(answers).length, [answers]);

  // ── Round picker + video intro ──────────────────────────────────────────────
  if (!started) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Are You a Naija Driver?" />
        <ScrollView contentContainerStyle={styles.introContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introIcon}><Gamepad2 size={30} color={Colors.primary} /></View>
          <Text style={styles.introTitle}>Play-Along · 3 rounds</Text>
          <Text style={styles.introBody}>
            Watch the round briefing, then take the gamified quiz. Answer fast and keep your streak alive to score higher.
          </Text>

          <Text style={styles.catLabel}>Choose a round</Text>
          <SegmentedControl options={ROUND_OPTIONS} value={String(roundNo)} onChange={(v) => setRoundNo(Number(v))} scrollable />

          <Text style={styles.roundTitle}>{round.label} · {round.title}</Text>
          <Text style={styles.roundBlurb}>{round.blurb}</Text>

          <View style={{ height: Spacing.sm }} />
          <RoundVideoCard video={round.video} />

          <View style={styles.note}><Text style={styles.noteText}>{NDC1_MERIT_NOTE}</Text></View>
          <View style={{ height: Spacing.md }} />
          <PrimaryButton
            label={q.isLoading ? 'Loading…' : `Start ${round.label}`}
            onPress={startRound}
            loading={q.isLoading}
            disabled={q.isLoading || questions.length === 0}
          />
          {questions.length === 0 && !q.isLoading ? (
            <Text style={styles.emptyHint}>No questions available for this round yet.</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (q.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={round.label} />
        <StateView kind="error" title="Couldn’t load the quiz" actionLabel="Retry" onAction={() => q.refetch()} />
      </SafeAreaView>
    );
  }
  if (!current) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={round.label} />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`${round.label} · ${round.title}`} showBack={false} />

      {/* Gamification bar: score + streak + timer */}
      <View style={styles.gameBar}>
        <View style={styles.gameStat}><Trophy size={15} color={Colors.gold} /><Text style={styles.gameStatText}>{score}</Text></View>
        <View style={styles.gameStat}><Flame size={15} color={streak > 0 ? '#F97316' : Colors.outline} /><Text style={[styles.gameStatText, streak > 0 && { color: '#F97316' }]}>{streak}x</Text></View>
        <View style={styles.timer}><Timer size={16} color={secs <= 5 ? Colors.error : Colors.secondary} /><Text style={[styles.timerText, secs <= 5 && { color: Colors.error }]}>{secs}s</Text></View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.qCount}>Question {index + 1}/{questions.length}</Text>
      </View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${((index + 1) / questions.length) * 100}%` }]} /></View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.prompt}>{current.prompt}</Text>
        {current.options.map((o) => {
          const sel = answers[current.id] === o.id;
          const isCorrect = revealed && o.id === current.correctOptionId;
          const isWrongPick = revealed && sel && o.id !== current.correctOptionId;
          return (
            <Pressable
              key={o.id}
              style={[styles.option, sel && styles.optionSel, isCorrect && styles.optionCorrect, isWrongPick && styles.optionWrong]}
              onPress={() => pick(current.id, o.id)}
              disabled={revealed}
            >
              {isCorrect ? <CheckCircle2 size={20} color="#16A34A" />
                : isWrongPick ? <XCircle size={20} color={Colors.error} />
                : sel ? <CheckCircle2 size={20} color={Colors.primary} />
                : <Circle size={20} color={Colors.outline} />}
              <Text style={[styles.optionText, sel && styles.optionTextSel]}>{o.label}</Text>
            </Pressable>
          );
        })}

        {revealed ? (
          <View style={[styles.feedback, lastPoints > 0 ? styles.feedbackGood : styles.feedbackBad]}>
            <Text style={styles.feedbackTitle}>
              {lastPoints > 0 ? `Correct! +${lastPoints} pts${streak > 1 ? ` · ${streak}x streak 🔥` : ''}` : 'Not quite'}
            </Text>
            {current.explanation ? <Text style={styles.feedbackText}>{current.explanation}</Text> : null}
          </View>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label={index < questions.length - 1 ? 'Next' : submit.isPending ? 'Scoring…' : 'Finish'}
          onPress={advance}
          loading={submit.isPending}
          disabled={submit.isPending || (gamified && !revealed)}
        />
        <Text style={styles.answeredHint}>{gamified ? `${correctCount} correct` : `${answered} answered`}</Text>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  introContent: { padding: Spacing.containerMargin, gap: Spacing.sm },
  introIcon: { width: 60, height: 60, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  introTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  introBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  catLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  roundTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  roundBlurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  note: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  emptyHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  gameBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  gameStat: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  gameStatText: { ...Typography.labelMd, color: Colors.onSurface, fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  qCount: { ...Typography.labelMd, color: Colors.onSurface },
  timer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginLeft: 'auto' },
  timerText: { ...Typography.titleMd, color: Colors.secondary, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 4, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  progressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: Radius.full },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm },
  prompt: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLowest },
  optionSel: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  optionCorrect: { borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.10)' },
  optionWrong: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  optionTextSel: { color: Colors.primary, fontWeight: '600' as const },
  feedback: { borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs },
  feedbackGood: { backgroundColor: 'rgba(22,163,74,0.10)' },
  feedbackBad: { backgroundColor: Colors.errorContainer },
  feedbackTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 2 },
  feedbackText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  answeredHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
