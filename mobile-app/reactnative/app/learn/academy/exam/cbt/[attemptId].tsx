import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Flag, Calculator, Grid3x3, ChevronLeft, ChevronRight, CloudOff, X, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import QuestionCard from '@/features/academy/components/QuestionCard';
import { useAttempt } from '@/features/academy/hooks';
import { patchAttemptLocal } from '@/features/academy/api';
import { useConnectivity } from '@/features/academy/offlineQueue';
import { formatClock, CBT_SERVER_AUTH_NOTE } from '@/features/academy/constants';

/**
 * X7 — CBT exam simulator. Full-screen timed with question navigator,
 * flag-for-review and calculator. OFFLINE-CAPABLE: questions come from the
 * locally bundled mock attempt, answers/flags persist to the local working copy
 * (patchAttemptLocal), and the countdown runs client-side. The timer is advisory
 * only — the server is authoritative for final time + score on submit.
 */
export default function CbtSimulator() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const attempt = useAttempt(attemptId);
  const { offline } = useConnectivity();

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [remaining, setRemaining] = useState<number>(0);
  const [showNav, setShowNav] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // Hydrate from the attempt working copy.
  useEffect(() => {
    if (attempt.data) {
      setAnswers(attempt.data.answers ?? {});
      setFlagged(new Set(attempt.data.flagged ?? []));
      setRemaining(attempt.data.remainingSec);
    }
  }, [attempt.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side countdown (advisory). Persists to the local copy each tick.
  useEffect(() => {
    if (!attempt.data) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        const next = Math.max(0, r - 1);
        patchAttemptLocal(attemptId, { remainingSec: next });
        if (next === 0) goSubmit(true);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [attempt.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const questions = attempt.data?.questions ?? [];
  const q = questions[idx];

  const select = (optionId: string) => {
    if (!q) return;
    // Multi-answer questions toggle membership; single-answer replace. Without
    // the multi branch a `multi` blueprint question is unanswerable/miscored.
    const current = answers[q.id] ?? [];
    const picks = q.type === 'multi'
      ? (current.includes(optionId) ? current.filter((o) => o !== optionId) : [...current, optionId])
      : [optionId];
    const next = { ...answers, [q.id]: picks };
    setAnswers(next);
    patchAttemptLocal(attemptId, { answers: next });
  };

  const toggleFlag = () => {
    if (!q) return;
    const next = new Set(flagged);
    next.has(q.id) ? next.delete(q.id) : next.add(q.id);
    setFlagged(next);
    patchAttemptLocal(attemptId, { flagged: [...next] });
  };

  const goSubmit = (_auto = false) => {
    // Do NOT re-persist from component state here. Answers, flags and the
    // countdown are already saved incrementally (select / toggleFlag / each tick
    // call patchAttemptLocal with fresh values). On the timer's auto-submit this
    // function runs from the countdown effect's closure, which captured the
    // STALE post-hydration state ({} answers, empty flags) — re-patching it would
    // overwrite the good working copy and score a completed attempt 0%.
    router.replace(`/learn/academy/exam/submit/${attemptId}`);
  };

  const answeredCount = useMemo(() => Object.values(answers).filter((a) => a.length).length, [answers]);
  const lowTime = remaining > 0 && remaining < 60;

  if (attempt.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading exam…" /></SafeAreaView>;
  if (!attempt.data || !q) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Exam not found" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top bar: timer + tools */}
      <View style={styles.topBar}>
        <View style={[styles.timer, lowTime && styles.timerLow]}>
          <Text style={[styles.timerText, lowTime && styles.timerTextLow]}>{formatClock(remaining)}</Text>
        </View>
        <View style={styles.tools}>
          {offline ? <View style={styles.offlinePill}><CloudOff size={14} color={Colors.onWarning} /></View> : null}
          <Pressable onPress={() => setShowInfo(true)} hitSlop={8} style={styles.toolBtn}><Info size={20} color={Colors.onSurfaceVariant} /></Pressable>
          {attempt.data.calculatorAllowed ? (
            <Pressable onPress={() => setShowCalc(true)} hitSlop={8} style={styles.toolBtn}><Calculator size={20} color={Colors.onSurface} /></Pressable>
          ) : null}
          <Pressable onPress={() => setShowNav(true)} hitSlop={8} style={styles.toolBtn}><Grid3x3 size={20} color={Colors.onSurface} /></Pressable>
        </View>
      </View>

      {/* Question */}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.qHead}>
          <Text style={styles.qNum}>Question {idx + 1} of {questions.length}</Text>
          <Pressable onPress={toggleFlag} style={[styles.flagBtn, flagged.has(q.id) && styles.flagBtnOn]}>
            <Flag size={14} color={flagged.has(q.id) ? Colors.white : Colors.onSurfaceVariant} fill={flagged.has(q.id) ? Colors.white : 'transparent'} />
            <Text style={[styles.flagText, flagged.has(q.id) && styles.flagTextOn]}>{flagged.has(q.id) ? 'Flagged' : 'Flag'}</Text>
          </Pressable>
        </View>
        <QuestionCard question={q} selected={answers[q.id] ?? []} onSelect={select} />
      </ScrollView>

      {/* Nav buttons */}
      <View style={styles.bottomBar}>
        <Pressable style={[styles.navBtn, idx === 0 && styles.navBtnDisabled]} disabled={idx === 0} onPress={() => setIdx((i) => i - 1)}>
          <ChevronLeft size={20} color={idx === 0 ? Colors.outline : Colors.onSurface} />
          <Text style={styles.navText}>Prev</Text>
        </Pressable>
        {idx < questions.length - 1 ? (
          <Pressable style={styles.nextBtn} onPress={() => setIdx((i) => i + 1)}>
            <Text style={styles.nextText}>Next</Text>
            <ChevronRight size={20} color={Colors.onPrimary} />
          </Pressable>
        ) : (
          <Pressable style={[styles.nextBtn, styles.submitBtn]} onPress={() => goSubmit()}>
            <Text style={styles.nextText}>Review & submit</Text>
          </Pressable>
        )}
      </View>

      {/* Question navigator (X7) */}
      <Modal visible={showNav} animationType="slide" transparent onRequestClose={() => setShowNav(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Question navigator</Text>
              <Pressable onPress={() => setShowNav(false)} hitSlop={8}><X size={22} color={Colors.onSurface} /></Pressable>
            </View>
            <Text style={styles.sheetSub}>{answeredCount}/{questions.length} answered · {flagged.size} flagged</Text>
            <View style={styles.navGrid}>
              {questions.map((qq, i) => {
                const answered = (answers[qq.id] ?? []).length > 0;
                const isFlag = flagged.has(qq.id);
                return (
                  <Pressable key={qq.id} onPress={() => { setIdx(i); setShowNav(false); }}
                    style={[styles.navCell, answered && styles.navCellAnswered, isFlag && styles.navCellFlag, i === idx && styles.navCellCurrent]}>
                    <Text style={[styles.navCellText, (answered || isFlag) && styles.navCellTextOn]}>{i + 1}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.legend}>
              <Legend color={Colors.teal} label="Answered" />
              <Legend color={Colors.gold} label="Flagged" />
              <Legend color={Colors.surfaceContainerHigh} label="Unanswered" />
            </View>
          </View>
        </View>
      </Modal>

      {/* Calculator */}
      <Modal visible={showCalc} animationType="fade" transparent onRequestClose={() => setShowCalc(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.calcSheet}>
            <View style={styles.sheetHead}><Text style={styles.sheetTitle}>Calculator</Text><Pressable onPress={() => setShowCalc(false)} hitSlop={8}><X size={22} color={Colors.onSurface} /></Pressable></View>
            <MiniCalculator />
          </View>
        </View>
      </Modal>

      {/* Server-authoritative timing note */}
      <Modal visible={showInfo} animationType="fade" transparent onRequestClose={() => setShowInfo(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.infoSheet}>
            <View style={styles.sheetHead}><Text style={styles.sheetTitle}>About this mock</Text><Pressable onPress={() => setShowInfo(false)} hitSlop={8}><X size={22} color={Colors.onSurface} /></Pressable></View>
            <Text style={styles.infoText}>{CBT_SERVER_AUTH_NOTE}</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

/** Minimal on-screen calculator (no deps) — enough for the CBT slice. */
function MiniCalculator() {
  const [expr, setExpr] = useState('');
  const [out, setOut] = useState('0');
  const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '=', '+'];
  const press = (k: string) => {
    if (k === '=') {
      try {
        // eslint-disable-next-line no-eval
        const v = String(eval(expr.replace(/[^0-9+\-*/.()]/g, '')) ?? '');
        setOut(v); setExpr(v);
      } catch { setOut('Error'); }
    } else setExpr((e) => e + k);
  };
  return (
    <View>
      <View style={styles.calcDisplay}><Text style={styles.calcExpr} numberOfLines={1}>{expr || '0'}</Text><Text style={styles.calcOut} numberOfLines={1}>{out}</Text></View>
      <Pressable style={styles.calcClear} onPress={() => { setExpr(''); setOut('0'); }}><Text style={styles.calcClearText}>Clear</Text></Pressable>
      <View style={styles.calcGrid}>
        {keys.map((k) => (
          <Pressable key={k} style={[styles.calcKey, ['/', '*', '-', '+', '='].includes(k) && styles.calcKeyOp]} onPress={() => press(k)}>
            <Text style={[styles.calcKeyText, ['/', '*', '-', '+', '='].includes(k) && styles.calcKeyTextOp]}>{k}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  timer: { backgroundColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  timerLow: { backgroundColor: Colors.errorContainer },
  timerText: { ...Typography.titleMd, color: Colors.onSurface, fontVariant: ['tabular-nums'] },
  timerTextLow: { color: Colors.error },
  tools: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  offlinePill: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  toolBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xl },
  qHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  qNum: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  flagBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  flagBtnOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  flagText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  flagTextOn: { color: Colors.white, fontWeight: '700' },
  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.md, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  navBtnDisabled: { opacity: 0.5 },
  navText: { ...Typography.labelMd, color: Colors.onSurface },
  nextBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.primary },
  submitBtn: { backgroundColor: Colors.teal },
  nextText: { ...Typography.labelLg, color: Colors.onPrimary },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, maxHeight: '80%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4, marginBottom: Spacing.md },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  navCell: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerHigh },
  navCellAnswered: { backgroundColor: Colors.teal },
  navCellFlag: { backgroundColor: Colors.gold },
  navCellCurrent: { borderWidth: 2, borderColor: Colors.primary },
  navCellText: { ...Typography.labelMd, color: Colors.onSurface },
  navCellTextOn: { color: Colors.white },
  legend: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  calcSheet: { backgroundColor: Colors.background, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg },
  infoSheet: { backgroundColor: Colors.background, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg },
  infoText: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.md, lineHeight: 24 },
  calcDisplay: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.md, padding: Spacing.md, marginVertical: Spacing.md, minHeight: 64, justifyContent: 'center' },
  calcExpr: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'right' },
  calcOut: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'right' },
  calcClear: { alignSelf: 'flex-end', marginBottom: Spacing.sm },
  calcClearText: { ...Typography.labelMd, color: Colors.error },
  calcGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  calcKey: { width: '22%', flexGrow: 1, height: 56, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  calcKeyOp: { backgroundColor: Colors.primary },
  calcKeyText: { ...Typography.titleMd, color: Colors.onSurface },
  calcKeyTextOp: { color: Colors.onPrimary },
});
