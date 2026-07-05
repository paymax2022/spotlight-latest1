import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, Lock, CheckCircle2, Award, Briefcase, Users, FolderUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import Chip from '@/features/academy/components/Chip';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import { useTradeHub } from '@/features/academy/hooks';
import type { TradeModule } from '@/features/academy/types';

/** S1 — Trade track hub: chosen trade modules + project portfolio + credential. */
export default function TradeHubScreen() {
  const hub = useTradeHub();

  if (hub.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading your trade…" /></SafeAreaView>;
  if (hub.isError || !hub.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Could not load" message="Please try again." actionLabel="Retry" onAction={() => hub.refetch()} /></SafeAreaView>;

  const { track, modules, projects, credentialEarned } = hub.data;
  const TrackIcon = (Icons as unknown as Record<string, Icons.LucideIcon>)[track.icon] ?? Icons.Wrench;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <OfflineBanner />
        <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}><TrackIcon size={22} color={Colors.onPrimary} /></View>
            <Pressable onPress={() => router.push('/learn/academy/trade/mentors')} style={styles.heroMentor}>
              <Users size={16} color={Colors.onPrimary} />
              <Text style={styles.heroMentorText}>Mentors</Text>
            </Pressable>
          </View>
          <Text style={styles.heroKicker}>TRADE & SKILLS</Text>
          <Text style={styles.heroTitle}>{track.name}</Text>
          <Text style={styles.heroSub}>{track.tagline}</Text>
          <ProgressBar pct={track.progressPct} color={Colors.gold} trackColor="rgba(255,255,255,0.18)" style={{ marginTop: Spacing.sm }} />
          <Text style={styles.heroMeta}>{track.completedModules}/{track.moduleCount} modules · {track.progressPct}% complete</Text>
        </LinearGradient>

        {/* Credential status / earning bridge */}
        <Pressable style={[styles.bridge, shadow1]} onPress={() => router.push('/learn/academy/earn')}>
          <View style={styles.bridgeIcon}><Briefcase size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bridgeTitle}>{credentialEarned ? 'Credential earned — unlock earning' : 'Finish to earn a credential'}</Text>
            <Text style={styles.bridgeSub}>Unlocks Paymax roles: {track.unlocksRoles.join(', ')}</Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>

        {/* Modules */}
        <Text style={styles.sectionTitle}>Modules</Text>
        {modules.map((m) => <ModuleRow key={m.id} m={m} />)}

        {/* Portfolio / projects */}
        {projects.length ? (
          <>
            <Text style={styles.sectionTitle}>Portfolio</Text>
            {projects.map((p) => (
              <Pressable key={p.id} style={[styles.card, shadow1]} onPress={() => router.push(`/learn/academy/trade/project/${p.id}`)}>
                <View style={styles.projIcon}><FolderUp size={18} color={Colors.secondary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{p.title}</Text>
                  <Text style={styles.cardSub} numberOfLines={1}>{p.brief}</Text>
                </View>
                {p.status === 'graded' ? <Chip label={`${p.scorePct}%`} color={Colors.teal} bg={Colors.iconBgTeal} small /> :
                  p.status === 'submitted' ? <Chip label="Submitted" color={Colors.secondary} bg={Colors.iconBgBlue} small /> :
                    <Chip label="Open" color={Colors.onWarning} bg={Colors.iconBgGold} small />}
              </Pressable>
            ))}
          </>
        ) : null}

        {/* Other trades */}
        <Pressable style={styles.switchRow} onPress={() => router.push('/learn/academy/trade/tracks')}>
          <Text style={styles.switchText}>Explore other trades</Text>
          <ChevronRight size={16} color={Colors.primary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ModuleRow({ m }: { m: TradeModule }) {
  const locked = m.status === 'locked';
  const done = m.status === 'completed';
  const onPress = () => {
    if (locked) return;
    if (m.kind === 'assessment' && m.assessmentId) router.push(`/learn/academy/trade/assessment/${m.assessmentId}`);
    else if (m.kind === 'project' && m.projectId) router.push(`/learn/academy/trade/project/${m.projectId}`);
    else router.push(`/learn/academy/trade/module/${m.id}`);
  };
  const kindLabel = m.kind === 'assessment' ? 'Assessment' : m.kind === 'project' ? 'Project' : m.kind === 'practical' ? 'Practical' : 'Theory';
  return (
    <Pressable style={[styles.card, shadow1, locked && styles.cardLocked]} onPress={onPress} disabled={locked}>
      <View style={[styles.modBadge, done && { backgroundColor: Colors.iconBgTeal }]}>
        {done ? <CheckCircle2 size={18} color={Colors.teal} /> : locked ? <Lock size={16} color={Colors.onSurfaceVariant} /> : <Text style={styles.modOrder}>{m.order}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{m.title}</Text>
        <Text style={styles.cardSub} numberOfLines={1}>{m.outcome}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Chip label={kindLabel} color={Colors.secondary} bg={Colors.iconBgBlue} small />
        <Text style={styles.modMins}>{m.estMinutes}m</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  heroIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroMentor: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full },
  heroMentorText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' },
  heroKicker: { ...Typography.labelSm, color: Colors.gold, letterSpacing: 1, fontWeight: '700' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary, marginTop: 2 },
  heroSub: { ...Typography.bodySm, color: Colors.inversePrimary },
  heroMeta: { ...Typography.labelSm, color: Colors.inversePrimary, marginTop: 6 },
  bridge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  bridgeIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  bridgeTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bridgeSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  cardLocked: { opacity: 0.6 },
  modBadge: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  modOrder: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  modMins: { ...Typography.caption, color: Colors.onSurfaceVariant },
  projIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.md },
  switchText: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
});
