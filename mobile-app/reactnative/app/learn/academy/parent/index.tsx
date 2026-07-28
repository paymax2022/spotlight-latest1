import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Users, Plus, ChevronRight, Bell, Flame, ShieldCheck, GraduationCap, Wallet, FileText, CreditCard, Award, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useChildren, useApprovals, useParentNotifications } from '@/features/academy/hooks';
import type { ChildSummary } from '@/features/academy/types';

/** P1 — Parent home: children overview, alerts, and quick links into the parent area. */
export default function ParentHome() {
  const children = useChildren();
  const approvals = useApprovals();
  const notifications = useParentNotifications();

  const pendingApprovals = approvals.data?.filter((a) => a.status === 'pending').length ?? 0;
  const unread = notifications.data?.filter((n) => !n.read).length ?? 0;

  if (children.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading family…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={children.isRefetching} onRefresh={() => { children.refetch(); approvals.refetch(); notifications.refetch(); }} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>PARENT AREA</Text>
            <Text style={styles.hi}>Your family</Text>
          </View>
          <Pressable style={styles.bell} onPress={() => router.push('/learn/academy/parent/notifications')} accessibilityLabel="Notifications">
            <Bell size={20} color={Colors.onSurface} />
            {unread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View> : null}
          </Pressable>
        </View>

        {/* Approvals banner */}
        {pendingApprovals > 0 ? (
          <Pressable onPress={() => router.push('/learn/academy/parent/approvals')}>
            <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.alertCard, shadow3]}>
              <ShieldCheck size={20} color={Colors.gold} />
              <Text style={styles.alertText}>{pendingApprovals} purchase approval{pendingApprovals > 1 ? 's' : ''} awaiting your decision</Text>
              <ChevronRight size={18} color={Colors.onPrimary} />
            </LinearGradient>
          </Pressable>
        ) : null}

        {/* Children */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>Children</Text>
          <Pressable style={styles.addBtn} onPress={() => router.push('/learn/academy/parent/add-child')}>
            <Plus size={16} color={Colors.primary} /><Text style={styles.addText}>Add child</Text>
          </Pressable>
        </View>
        {children.data?.length ? children.data.map((c) => <ChildCard key={c.minorId} c={c} />) : (
          <StateView kind="empty" icon="Users" title="No children yet" message="Add or link a child to get started." compact />
        )}

        {/* Quick links */}
        <Text style={styles.section}>Manage</Text>
        <View style={styles.grid}>
          <QuickLink icon={FileText} label="Reports" onPress={() => router.push('/learn/academy/parent/reports')} />
          <QuickLink icon={Wallet} label="EduPay fees" onPress={() => router.push('/learn/academy/parent/edupay')} />
          <QuickLink icon={GraduationCap} label="School fees" onPress={() => router.push('/learn/academy/fees')} />
          <QuickLink icon={Award} label="Scholarships" onPress={() => router.push('/learn/academy/parent/scholarships')} />
          <QuickLink icon={CreditCard} label="Billing" onPress={() => router.push('/learn/academy/parent/billing')} />
        </View>

        {/* Switch back to learner */}
        <Pressable style={styles.switchRow} onPress={() => router.replace('/learn/academy')}>
          <GraduationCap size={16} color={Colors.secondary} />
          <Text style={styles.switchText}>Switch to learner view</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChildCard({ c }: { c: ChildSummary }) {
  const overCap = c.dailyCapMinutes > 0 && c.minutesToday > c.dailyCapMinutes;
  return (
    <Pressable
      style={[styles.childCard, shadow1]}
      onPress={() => c.linked
        ? router.push(`/learn/academy/parent/child/${c.minorId}`)
        : router.push('/learn/academy/parent/add-child')}
    >
      <View style={[styles.avatar, { backgroundColor: (Colors as unknown as Record<string, string>)[c.avatarColorKey] ?? Colors.iconBgPurple }]}>
        <Text style={styles.avatarText}>{c.displayName.charAt(0)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.childHead}>
          <Text style={styles.childName}>{c.displayName}</Text>
          {!c.linked ? <Chip label="Link pending" color={Colors.onWarning} bg={Colors.iconBgGold} small />
            : c.alertCount > 0 ? <Chip label={`${c.alertCount} alert${c.alertCount > 1 ? 's' : ''}`} color={Colors.error} bg={Colors.errorContainer} small /> : null}
        </View>
        <Text style={styles.childMeta}>{c.classCode}</Text>
        {c.linked ? (
          <>
            <View style={styles.childStats}>
              <View style={styles.statItem}><Flame size={13} color={Colors.gold} /><Text style={styles.statText}>{c.streakDays}d streak</Text></View>
              <View style={styles.statItem}><Clock size={13} color={overCap ? Colors.error : Colors.onSurfaceVariant} /><Text style={[styles.statText, overCap && { color: Colors.error }]}>{c.minutesToday}/{c.dailyCapMinutes}m today</Text></View>
            </View>
            <ProgressBar pct={c.readinessPct} height={6} style={{ marginTop: 6 }} />
          </>
        ) : (
          <Text style={styles.linkPrompt}>Tap to link &amp; record consent →</Text>
        )}
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

function QuickLink({ icon: Icon, label, onPress }: { icon: typeof Wallet; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.quick, shadow1]} onPress={onPress}>
      <Icon size={20} color={Colors.primary} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  kicker: { ...Typography.labelSm, color: Colors.primary, letterSpacing: 1, fontWeight: '700' },
  hi: { ...Typography.headlineMd, color: Colors.onSurface },
  bell: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  badge: { position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { ...Typography.caption, color: Colors.white, fontWeight: '700' },
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md },
  alertText: { ...Typography.labelMd, color: Colors.onPrimary, flex: 1 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addText: { ...Typography.labelMd, color: Colors.primary },
  childCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' },
  childHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'space-between' },
  childName: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  childMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  childStats: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  linkPrompt: { ...Typography.labelSm, color: Colors.secondary, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quick: { width: '47.5%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  quickLabel: { ...Typography.labelMd, color: Colors.onSurface },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, marginTop: Spacing.sm },
  switchText: { ...Typography.labelMd, color: Colors.secondary },
});
