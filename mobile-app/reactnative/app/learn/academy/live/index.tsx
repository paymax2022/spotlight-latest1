import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Radio, Play, CalendarClock, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useLiveSessions } from '@/features/academy/hooks';
import type { LiveSession, LiveStatus } from '@/features/academy/types';

const STATUS: Record<LiveStatus, { label: string; color: string; bg: string }> = {
  live:     { label: 'LIVE',     color: Colors.error,     bg: Colors.errorContainer },
  upcoming: { label: 'Upcoming', color: Colors.secondary, bg: Colors.iconBgBlue },
  replay:   { label: 'Replay',   color: Colors.teal,      bg: Colors.iconBgTeal },
};

function whenLabel(s: LiveSession): string {
  const d = new Date(s.startsAt);
  if (s.status === 'live') return `On now · ${s.viewers ?? 0} watching`;
  if (s.status === 'replay') return `Recorded ${d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}`;
  return d.toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** C1 — Live classes schedule: upcoming / live / replay. */
export default function LiveScheduleScreen() {
  const sessions = useLiveSessions();
  if (sessions.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading classes…" /></SafeAreaView>;

  const data = sessions.data ?? [];
  const groups: { key: LiveStatus; title: string }[] = [
    { key: 'live', title: 'Live now' },
    { key: 'upcoming', title: 'Upcoming' },
    { key: 'replay', title: 'Replays' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Live classes" subtitle="Moderated · raise-hand enabled" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {groups.map((g) => {
          const items = data.filter((s) => s.status === g.key);
          if (!items.length) return null;
          return (
            <View key={g.key} style={{ gap: Spacing.sm }}>
              <Text style={styles.sectionTitle}>{g.title}</Text>
              {items.map((s) => <SessionRow key={s.id} s={s} />)}
            </View>
          );
        })}
        {!data.length ? <StateView kind="empty" icon="Radio" title="No classes" message="Check back for scheduled live sessions." compact /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SessionRow({ s }: { s: LiveSession }) {
  const st = STATUS[s.status];
  const onPress = () => {
    if (s.status === 'replay') router.push(`/learn/academy/live/replay/${s.id}`);
    else router.push(`/learn/academy/live/room/${s.id}`);
  };
  const Icon = s.status === 'live' ? Radio : s.status === 'replay' ? Play : CalendarClock;
  return (
    <Pressable style={[styles.card, shadow1]} onPress={onPress}>
      <View style={[styles.icon, s.status === 'live' && { backgroundColor: Colors.errorContainer }]}>
        <Icon size={20} color={s.status === 'live' ? Colors.error : Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{s.title}</Text>
          <Chip label={st.label} color={st.color} bg={st.bg} small />
        </View>
        <Text style={styles.sub}>{s.subjectOrTrade} · {s.host}</Text>
        <View style={styles.metaRow}>
          {s.status === 'live' ? <Users size={12} color={Colors.onSurfaceVariant} /> : null}
          <Text style={styles.when}>{whenLabel(s)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  sectionTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  icon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  when: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
