import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  GraduationCap, ChevronRight, UserCircle, Users, ClipboardList, CheckSquare,
  Radio, Wallet, Building2, ShieldCheck, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatNaira } from '@/features/academy/constants';
import { useTutorMe, useTutorEarnings, useCohorts } from '@/features/academy/hooks';

/** Tutor home — the Teach hub. Surfaces verification status and links to T2–T8. */
export default function TutorHome() {
  const me = useTutorMe();
  const earnings = useTutorEarnings();
  const cohorts = useCohorts();

  if (me.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading your studio…" /></SafeAreaView>;

  // Not onboarded yet → push to T1.
  if (!me.data?.onboardingComplete) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
            <View style={styles.heroIcon}><GraduationCap size={24} color={Colors.onPrimary} /></View>
            <Text style={styles.heroTitle}>Teach on Spotlight</Text>
            <Text style={styles.heroSub}>Run cohorts, assign work, host live classes and get paid. Verify once to begin.</Text>
          </LinearGradient>
          <Pressable style={styles.cta} onPress={() => router.push('/learn/academy/tutor/onboard')}>
            <Text style={styles.ctaText}>Become a tutor</Text>
            <ChevronRight size={20} color={Colors.onPrimary} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const verified = me.data.verifyState === 'verified';
  const students = cohorts.data?.reduce((n, c) => n + c.studentCount, 0) ?? me.data.studentCount;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>{me.data.displayName}</Text>
            <Text style={styles.hiSub}>Tutor studio</Text>
          </View>
          <Chip
            label={verified ? 'Verified' : me.data.verifyState === 'pending' ? 'KYC pending' : 'Unverified'}
            color={verified ? Colors.teal : Colors.onWarning}
            bg={verified ? Colors.iconBgTeal : Colors.iconBgGold}
          />
        </View>

        {/* Verification banner */}
        <Pressable style={[styles.verifyCard, shadow1]} onPress={() => router.push('/learn/academy/tutor/onboard')}>
          <View style={styles.verifyIcon}>{verified ? <ShieldCheck size={20} color={Colors.teal} /> : <Clock size={20} color={Colors.onWarning} />}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.verifyTitle}>{verified ? 'You’re verified' : 'Verification in review'}</Text>
            <Text style={styles.verifySub}>{verified ? 'Payouts and live classes are unlocked.' : 'Payouts unlock once KYC clears.'}</Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, shadow1]}><Users size={20} color={Colors.secondary} /><Text style={styles.statNum}>{students}</Text><Text style={styles.statLabel}>students</Text></View>
          <Pressable style={[styles.statCard, shadow1]} onPress={() => router.push('/learn/academy/tutor/earnings')}>
            <Wallet size={20} color={Colors.teal} /><Text style={styles.statNum}>{formatNaira(earnings.data?.availableKobo)}</Text><Text style={styles.statLabel}>available</Text>
          </Pressable>
          <View style={[styles.statCard, shadow1]}><GraduationCap size={20} color={Colors.gold} /><Text style={styles.statNum}>{me.data.rating.toFixed(1)}</Text><Text style={styles.statLabel}>rating</Text></View>
        </View>

        {/* Tools */}
        <View style={styles.grid}>
          <Tile icon={UserCircle} label="My profile" onPress={() => router.push('/learn/academy/tutor/profile')} />
          <Tile icon={Users} label="Class roster" onPress={() => router.push('/learn/academy/tutor/roster')} />
          <Tile icon={ClipboardList} label="Assign work" onPress={() => router.push('/learn/academy/tutor/assignments')} />
          <Tile icon={CheckSquare} label="Review & grade" onPress={() => router.push('/learn/academy/tutor/grade')} />
          <Tile icon={Radio} label="Host live class" onPress={() => router.push('/learn/academy/tutor/live')} />
          <Tile icon={Wallet} label="Earnings & payouts" onPress={() => router.push('/learn/academy/tutor/earnings')} />
          <Tile icon={Building2} label="School admin" onPress={() => router.push('/learn/academy/tutor/school')} />
        </View>

        <Pressable style={[styles.switchCard, shadow1]} onPress={() => router.replace('/learn/academy')}>
          <Text style={styles.switchText}>Switch to learner home</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ icon: Icon, label, onPress }: { icon: typeof Users; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.tile, shadow1]} onPress={onPress}>
      <Icon size={22} color={Colors.primary} />
      <Text style={styles.tileLabel}>{label}</Text>
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
  hiSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  verifyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  verifyIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  verifyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  verifySub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 2 },
  statNum: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { width: '47.5%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  tileLabel: { ...Typography.labelMd, color: Colors.onSurface },
  switchCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm },
  switchText: { ...Typography.labelMd, color: Colors.onSurface },
});
