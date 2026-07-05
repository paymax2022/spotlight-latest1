import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Radio, CalendarClock, Users, Plus, Play } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatDate } from '@/features/academy/constants';
import { useLiveSessions, useCohorts } from '@/features/academy/hooks';
import type { LiveStatus } from '@/features/academy/types';

const STATUS_META: Record<LiveStatus, { label: string; color: string; bg: string }> = {
  live:     { label: 'LIVE',     color: Colors.error,     bg: Colors.errorContainer },
  upcoming: { label: 'Upcoming', color: Colors.secondary, bg: Colors.iconBgBlue },
  replay:   { label: 'Replay',   color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

/**
 * T6 — Host live class. Schedule a class for a cohort, then run it — reuses the
 * Phase-3 live room view (app/learn/academy/live/room/[id]) for the actual room.
 */
export default function TutorLive() {
  const sessions = useLiveSessions();
  const cohorts = useCohorts();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [cohortId, setCohortId] = useState<string | undefined>(undefined);
  const [scheduled, setScheduled] = useState<string | null>(null);

  if (sessions.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading classes…" /></SafeAreaView>;

  // Tutor sees the same sessions feed; hosting reuses the live room.
  const myCohort = cohortId ?? cohorts.data?.[0]?.id;
  const valid = title.trim().length >= 3 && !!myCohort;

  const schedule = () => {
    const c = cohorts.data?.find((x) => x.id === myCohort);
    setScheduled(`“${title.trim()}” scheduled for ${c?.name ?? 'your cohort'}. Learners will be notified.`);
    setTitle('');
    setOpen(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Host live class"
        subtitle="Schedule & run"
        rightSlot={<Pressable hitSlop={10} onPress={() => setOpen((o) => !o)} accessibilityLabel="Schedule class"><Plus size={22} color={Colors.primary} /></Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {scheduled ? (
          <View style={[styles.banner, shadow1]}><CalendarClock size={16} color={Colors.teal} /><Text style={styles.bannerText}>{scheduled}</Text></View>
        ) : null}

        {open ? (
          <View style={[styles.composer, shadow1]}>
            <Text style={styles.composerTitle}>Schedule a class</Text>
            <TextInput style={styles.input} placeholder="Topic (e.g. JAMB Maths revision)" placeholderTextColor={Colors.onSurfaceVariant} value={title} onChangeText={setTitle} />
            <Text style={styles.fieldLabel}>Cohort</Text>
            <View style={styles.pillRow}>
              {cohorts.data?.map((c) => {
                const on = (cohortId ?? cohorts.data?.[0]?.id) === c.id;
                return (
                  <Pressable key={c.id} style={[styles.pill, on && styles.pillOn]} onPress={() => setCohortId(c.id)}>
                    <Text style={[styles.pillText, on && styles.pillTextOn]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <PrimaryButton label="Schedule class" onPress={schedule} disabled={!valid} />
          </View>
        ) : null}

        <Text style={styles.section}>Your classes</Text>
        {sessions.data?.map((s) => {
          const m = STATUS_META[s.status];
          const canHost = s.status === 'live' || s.status === 'upcoming';
          return (
            <View key={s.id} style={[styles.card, shadow1]}>
              <View style={[styles.icon, { backgroundColor: m.bg }]}><Radio size={18} color={m.color} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{s.title}</Text>
                <Text style={styles.cardSub}>{s.subjectOrTrade} · {formatDate(s.startsAt)}</Text>
                <View style={styles.metaRow}>
                  <Chip label={m.label} color={m.color} bg={m.bg} small />
                  <View style={styles.dueRow}><Users size={12} color={Colors.onSurfaceVariant} /><Text style={styles.dueText}>{s.viewers ?? s.durationMin + 'min'}</Text></View>
                </View>
              </View>
              {canHost ? (
                <Pressable style={styles.hostBtn} onPress={() => router.push(`/learn/academy/live/room/${s.id}`)}>
                  <Play size={14} color={Colors.onPrimary} fill={Colors.onPrimary} />
                  <Text style={styles.hostText}>{s.status === 'live' ? 'Run' : 'Start'}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Text style={styles.note}>Running a class opens the moderated LiveKit room. Learners watch and raise hand; you host.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  composer: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  composerTitle: { ...Typography.titleMd, color: Colors.onSurface },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 48, color: Colors.onSurface, ...Typography.bodyMd },
  fieldLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  pillOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { ...Typography.labelSm, color: Colors.onSurface },
  pillTextOn: { color: Colors.onPrimary, fontWeight: '700' },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  icon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 6 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dueText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  hostBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  hostText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
