import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  Flame, Trophy, BookOpen, Sparkles, ChevronRight, GraduationCap, Wallet, Gift, CloudOff, Wifi,
  Search, Route, Target, Download, Users, Bookmark,
  Wrench, Briefcase, BadgeCheck, Radio, MessagesSquare, Bell, Megaphone,
  Presentation, Baby,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useConnectivity } from '@/features/academy/offlineQueue';
import { useMe, useGamificationProfile, useSubjects, useArenas, useRewardBalance, useRecommendations } from '@/features/academy/hooks';

/** L1 — Home / Today. Plan, streak, continue, exam readiness, rewards; offline banner. */
export default function AcademyHome() {
  const me = useMe();
  const gam = useGamificationProfile();
  const subjects = useSubjects();
  const arenas = useArenas();
  const balance = useRewardBalance();
  const recs = useRecommendations();
  const { offline, setOffline } = useConnectivity();

  const loading = me.isLoading || gam.isLoading;
  const onboardingDone = me.data?.onboardingComplete;
  const refreshing = me.isRefetching || subjects.isRefetching;
  const refetchAll = () => { me.refetch(); gam.refetch(); subjects.refetch(); arenas.refetch(); balance.refetch(); };

  if (loading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading your day…" /></SafeAreaView>;

  // First-run → onboarding.
  if (!onboardingDone) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
            <View style={styles.heroIcon}><GraduationCap size={24} color={Colors.onPrimary} /></View>
            <Text style={styles.heroTitle}>Spotlight Academy</Text>
            <Text style={styles.heroSub}>Learn. Play. Earn. Pass your exams with edutainment lessons, CBT mocks and learn-to-earn rewards.</Text>
          </LinearGradient>
          <Pressable style={styles.cta} onPress={() => router.push('/learn/academy/onboarding/role')}>
            <Text style={styles.ctaText}>Get started</Text>
            <ChevronRight size={20} color={Colors.onPrimary} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const continueSubject = subjects.data?.find((s) => s.progressPct > 0 && s.progressPct < 100) ?? subjects.data?.[0];
  const arena = arenas.data?.[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={Colors.primary} />}
      >
        {/* Greeting + dev offline toggle (simulated connectivity, mock mode) */}
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>Hello, {me.data?.displayName ?? 'learner'}</Text>
            <Text style={styles.hiSub}>{me.data?.classCode ?? ''} · let’s keep your streak alive</Text>
          </View>
          <Pressable onPress={() => router.push('/learn/academy/search')} style={styles.netToggle} accessibilityLabel="Search">
            <Search size={18} color={Colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => router.push('/learn/academy/notifications')} style={styles.netToggle} accessibilityLabel="Notifications">
            <Bell size={18} color={Colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => setOffline(!offline)} style={styles.netToggle} accessibilityLabel="Toggle simulated connectivity">
            {offline ? <CloudOff size={18} color={Colors.onWarning} /> : <Wifi size={18} color={Colors.teal} />}
          </Pressable>
        </View>

        <OfflineBanner />

        {/* Streak + XP */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, shadow1]}>
            <Flame size={20} color={Colors.gold} />
            <Text style={styles.statNum}>{gam.data?.streakDays ?? 0}</Text>
            <Text style={styles.statLabel}>day streak</Text>
          </View>
          <View style={[styles.statCard, shadow1]}>
            <Trophy size={20} color={Colors.secondary} />
            <Text style={styles.statNum}>Lv {gam.data?.level ?? 1}</Text>
            <Text style={styles.statLabel}>{gam.data?.xp ?? 0} XP</Text>
          </View>
          <Pressable style={[styles.statCard, shadow1]} onPress={() => router.push('/learn/academy/rewards')}>
            <Gift size={20} color={Colors.teal} />
            <Text style={styles.statNum}>{(balance.data?.points ?? 0).toLocaleString()}</Text>
            <Text style={styles.statLabel}>reward pts</Text>
          </Pressable>
        </View>

        {/* Continue learning */}
        {continueSubject ? (
          <Pressable style={[styles.continueCard, shadow1]} onPress={() => router.push(`/learn/academy/subject/${continueSubject.id}`)}>
            <View style={styles.continueIcon}><BookOpen size={22} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.continueLabel}>Continue learning</Text>
              <Text style={styles.continueTitle}>{continueSubject.name}</Text>
              <ProgressBar pct={continueSubject.progressPct} style={{ marginTop: 8 }} />
            </View>
            <ChevronRight size={20} color={Colors.onSurfaceVariant} />
          </Pressable>
        ) : null}

        {/* Exam readiness (the Crown teaser) */}
        {arena ? (
          <Pressable onPress={() => router.push(`/learn/academy/exam/${arena.id}`)}>
            <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.examCard, shadow3]}>
              <View style={styles.examTop}>
                <Sparkles size={18} color={Colors.gold} />
                <Text style={styles.examKicker}>EXAM ARENA</Text>
              </View>
              <Text style={styles.examTitle}>{arena.name} readiness</Text>
              <Text style={styles.examPct}>{arena.readinessPct}%</Text>
              <ProgressBar pct={arena.readinessPct} color={Colors.gold} trackColor="rgba(255,255,255,0.18)" style={{ marginTop: 6 }} />
              <Text style={styles.examSub}>Tap to take a CBT mock →</Text>
            </LinearGradient>
          </Pressable>
        ) : null}

        {/* Recommendations (Phase 2 — /progression/recommendations) */}
        {recs.data?.length ? (
          <>
            <Text style={styles.railTitle}>Recommended for you</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              {recs.data.map((r) => (
                <Pressable key={r.id} style={[styles.recCard, shadow1]} onPress={() => router.push(r.href as never)}>
                  <Sparkles size={16} color={Colors.gold} />
                  <Text style={styles.recTitle} numberOfLines={2}>{r.title}</Text>
                  <Text style={styles.recReason} numberOfLines={2}>{r.reason}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {/* Quick links */}
        <View style={styles.quickGrid}>
          <QuickLink icon={BookOpen} label="My subjects" onPress={() => router.push('/learn/academy/subjects')} />
          <QuickLink icon={Route} label="My path" onPress={() => router.push('/learn/academy/path')} />
          <QuickLink icon={Target} label="Adaptive practice" onPress={() => router.push('/learn/academy/practice/adaptive')} />
          <QuickLink icon={Flame} label="Daily goal" onPress={() => router.push('/learn/academy/goal')} />
          <QuickLink icon={GraduationCap} label="Exam arenas" onPress={() => router.push('/learn/academy/exam')} />
          <QuickLink icon={Download} label="Downloads" onPress={() => router.push('/learn/academy/downloads')} />
          <QuickLink icon={Bookmark} label="Bookmarks" onPress={() => router.push('/learn/academy/bookmarks')} />
          <QuickLink icon={Gift} label="Rewards" onPress={() => router.push('/learn/academy/rewards')} />
          <QuickLink icon={Wallet} label="Wallet & store" onPress={() => router.push('/learn/academy/wallet')} />
        </View>

        {/* Trade & Earn (the moat) */}
        <Text style={styles.railTitle}>Trade & Earn</Text>
        <Pressable onPress={() => router.push('/learn/academy/trade')}>
          <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.tradeCard, shadow3]}>
            <View style={styles.tradeIcon}><Wrench size={22} color={Colors.onPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tradeTitle}>Learn a trade, earn a credential</Text>
              <Text style={styles.tradeSub}>Build a portfolio, pass a practical assessment, unlock Paymax earning roles.</Text>
            </View>
            <ChevronRight size={20} color={Colors.onPrimary} />
          </LinearGradient>
        </Pressable>
        <View style={styles.quickGrid}>
          <QuickLink icon={Wrench} label="My trade track" onPress={() => router.push('/learn/academy/trade')} />
          <QuickLink icon={Briefcase} label="Earning opportunities" onPress={() => router.push('/learn/academy/earn')} />
          <QuickLink icon={BadgeCheck} label="My certificates" onPress={() => router.push('/learn/academy/certificates')} />
          <QuickLink icon={Users} label="Mentor connect" onPress={() => router.push('/learn/academy/trade/mentors')} />
        </View>

        {/* Live & Community */}
        <Text style={styles.railTitle}>Live & Community</Text>
        <View style={styles.quickGrid}>
          <QuickLink icon={Radio} label="Live classes" onPress={() => router.push('/learn/academy/live')} />
          <QuickLink icon={MessagesSquare} label="Study groups" onPress={() => router.push('/learn/academy/community')} />
          <QuickLink icon={Bell} label="Notifications" onPress={() => router.push('/learn/academy/notifications')} />
          <QuickLink icon={Megaphone} label="Announcements" onPress={() => router.push('/learn/academy/announcements')} />
        </View>

        {/* Parent area entry (role switch) */}
        <Pressable style={[styles.parentCard, shadow1]} onPress={() => router.push('/learn/academy/parent')}>
          <View style={styles.parentIcon}><Users size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.parentTitle}>Parent area</Text>
            <Text style={styles.parentSub}>Track children, controls, reports, school fees</Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>

        {/* Teach entry (tutor role switch) — Phase 4 */}
        <Pressable style={[styles.parentCard, shadow1]} onPress={() => router.push('/learn/academy/tutor')}>
          <View style={styles.parentIcon}><Presentation size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.parentTitle}>Teach on Spotlight</Text>
            <Text style={styles.parentSub}>Run cohorts, assign work, host live classes, get paid</Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>

        {/* Little Learners (ECCE) — parent-gated kids surface, Phase 4 */}
        <Pressable style={[styles.parentCard, shadow1]} onPress={() => router.push('/learn/academy/ecce')}>
          <View style={styles.parentIcon}><Baby size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.parentTitle}>Little Learners</Text>
            <Text style={styles.parentSub}>Play-and-learn for under-6s · parent-gated</Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickLink({ icon: Icon, label, onPress }: { icon: typeof BookOpen; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.quick, shadow1]} onPress={onPress}>
      <Icon size={22} color={Colors.primary} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg },
  heroIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary },
  heroSub: { ...Typography.bodyMd, color: Colors.inversePrimary, marginTop: Spacing.xs },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: Colors.primary, borderRadius: Radius.lg, height: 56 },
  ctaText: { ...Typography.labelLg, color: Colors.onPrimary },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hi: { ...Typography.headlineMd, color: Colors.onSurface },
  hiSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  netToggle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 2 },
  statNum: { ...Typography.titleLg, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  continueCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  continueIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  continueLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  continueTitle: { ...Typography.titleMd, color: Colors.onSurface },
  examCard: { borderRadius: Radius.xl, padding: Spacing.lg },
  examTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  examKicker: { ...Typography.labelSm, color: Colors.gold, letterSpacing: 1, fontWeight: '700' },
  examTitle: { ...Typography.titleMd, color: Colors.onPrimary, marginTop: Spacing.xs },
  examPct: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 40, lineHeight: 46 },
  examSub: { ...Typography.labelSm, color: Colors.inversePrimary, marginTop: Spacing.sm },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quick: { width: '47.5%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  quickLabel: { ...Typography.labelMd, color: Colors.onSurface },
  railTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  rail: { gap: Spacing.sm, paddingVertical: 2 },
  recCard: { width: 160, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  recTitle: { ...Typography.labelLg, color: Colors.onSurface },
  recReason: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  tradeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.xl, padding: Spacing.lg },
  tradeIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  tradeTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  tradeSub: { ...Typography.bodySm, color: Colors.inversePrimary, marginTop: 2 },
  parentCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  parentIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  parentTitle: { ...Typography.titleMd, color: Colors.onSurface },
  parentSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
