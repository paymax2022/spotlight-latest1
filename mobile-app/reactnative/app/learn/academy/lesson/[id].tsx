import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Play, Pause, Captions, Headphones, Gauge, Download, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useLesson } from '@/features/academy/hooks';
import { useConnectivity } from '@/features/academy/offlineQueue';
import { formatClock } from '@/features/academy/constants';
import { track } from '@/features/academy/analytics';

const SPEEDS = [1, 1.25, 1.5, 2] as const;

/**
 * L6 — Lesson player. Edutainment "video" simulated with a progress clock so the
 * slice runs with no media dep. Low-data affordances per nfr.md: captions,
 * audio-only, playback speed, and an offline banner. Plays from the downloaded
 * copy when offline.
 */
export default function LessonPlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lesson = useLesson(id);
  const { offline } = useConnectivity();

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captions, setCaptions] = useState(true);
  const [audioOnly, setAudioOnly] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const duration = lesson.data?.durationSec ?? 0;
  const completed = duration > 0 && elapsed >= duration;
  // Offline + not downloaded → playback unavailable (low-data correctness).
  const unavailable = offline && lesson.data && !lesson.data.downloaded;

  useEffect(() => {
    if (lesson.data) track('lesson_started', { lesson: lesson.data.id, offlineOrigin: offline });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.data?.id]);

  useEffect(() => {
    if (!playing || completed) return;
    const t = setInterval(() => {
      setElapsed((e) => {
        const next = Math.min(duration, e + speed);
        if (next >= duration) {
          setPlaying(false);
          track('lesson_completed', { lesson: id });
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [playing, completed, speed, duration, id]);

  const transcript = useMemo(() => lesson.data?.transcript ?? '', [lesson.data]);

  if (lesson.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading lesson…" /></SafeAreaView>;
  if (!lesson.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Lesson not found" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Lesson" subtitle={lesson.data.title} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Player surface */}
        <View style={[styles.stage, audioOnly && styles.stageAudio]}>
          {unavailable ? (
            <View style={styles.center}>
              <Download size={28} color={Colors.onPrimary} />
              <Text style={styles.stageNote}>Not downloaded. Connect or download to play.</Text>
            </View>
          ) : audioOnly ? (
            <View style={styles.center}>
              <Headphones size={32} color={Colors.onPrimary} />
              <Text style={styles.stageNote}>Audio-only · saves data</Text>
            </View>
          ) : (
            <View style={styles.center}>
              <Pressable onPress={() => setPlaying((p) => !p)} style={styles.bigPlay} disabled={completed}>
                {playing ? <Pause size={28} color={Colors.primary} /> : <Play size={28} color={Colors.primary} fill={Colors.primary} />}
              </Pressable>
            </View>
          )}
          {captions && (playing || completed) && !unavailable ? (
            <View style={styles.captionBar}>
              <Text style={styles.captionText} numberOfLines={2}>
                {transcript.slice(0, 90)}…
              </Text>
            </View>
          ) : null}
        </View>

        {/* Scrubber */}
        <View style={styles.scrub}>
          <ProgressBar pct={duration ? (elapsed / duration) * 100 : 0} />
          <View style={styles.timeRow}>
            <Text style={styles.time}>{formatClock(elapsed)}</Text>
            <Text style={styles.time}>{formatClock(duration)}</Text>
          </View>
        </View>

        {/* Low-data controls */}
        <View style={styles.controls}>
          <Toggle active={captions} icon={Captions} label="Captions" onPress={() => setCaptions((v) => !v)} />
          <Toggle active={audioOnly} icon={Headphones} label="Audio only" onPress={() => setAudioOnly((v) => !v)} />
          <Pressable
            style={[styles.ctrl, styles.ctrlActive]}
            onPress={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          >
            <Gauge size={18} color={Colors.primary} />
            <Text style={styles.ctrlLabelActive}>{speed}x</Text>
          </Pressable>
        </View>

        {/* Download state */}
        <View style={styles.downloadRow}>
          {lesson.data.downloaded
            ? <><CheckCircle2 size={16} color={Colors.teal} /><Text style={styles.downloadText}>Available offline · {Math.round(lesson.data.dataBudgetKb / 1024)}MB</Text></>
            : <><Download size={16} color={Colors.onSurfaceVariant} /><Text style={styles.downloadText}>Download for offline · {Math.round(lesson.data.dataBudgetKb / 1024)}MB</Text></>}
        </View>

        {/* Transcript (L7 concept inline) */}
        <Text style={styles.section}>Transcript</Text>
        <Text style={styles.transcript}>{transcript}</Text>

        {completed ? (
          <Pressable style={styles.nextBtn} onPress={() => router.back()}>
            <Text style={styles.nextText}>Lesson complete · back to topic</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({ active, icon: Icon, label, onPress }: { active: boolean; icon: typeof Captions; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.ctrl, active && styles.ctrlActive]} onPress={onPress} accessibilityState={{ selected: active }}>
      <Icon size={18} color={active ? Colors.primary : Colors.onSurfaceVariant} />
      <Text style={active ? styles.ctrlLabelActive : styles.ctrlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  stage: { aspectRatio: 16 / 9, backgroundColor: Colors.backdropDark, borderRadius: Radius.lg, overflow: 'hidden', justifyContent: 'center' },
  stageAudio: { aspectRatio: undefined, height: 140 },
  center: { alignItems: 'center', gap: Spacing.sm },
  bigPlay: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center' },
  stageNote: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  captionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', padding: Spacing.sm },
  captionText: { ...Typography.bodySm, color: Colors.white, textAlign: 'center' },
  scrub: { marginTop: Spacing.md },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant },
  controls: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  ctrl: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  ctrlActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  ctrlLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ctrlLabelActive: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  downloadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  downloadText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.lg, marginBottom: Spacing.xs },
  transcript: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 24 },
  nextBtn: { marginTop: Spacing.lg, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center' },
  nextText: { ...Typography.labelLg, color: Colors.white },
});
