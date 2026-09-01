import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import {
  ArrowLeft, Bell, CalendarDays, Megaphone, ListTodo, ChevronRight, AlertTriangle, UserRound, ShieldCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import MembershipCardView from '@/features/association/components/MembershipCardView';
import QuickNav from '@/features/association/components/QuickNav';
import { useDashboard } from '@/features/association/hooks/useAssociation';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { formatNaira, formatDateTime, relativeTime, dueLabel } from '@/features/association/utils/associationFormatters';


export default function MemberHome() {
  const dash = useDashboard();
  const access = useAdminAccess();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/association')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>My membership</Text>
          <Text style={styles.headerTitle}>{dash.data?.card.organisationAcronym ?? 'Dashboard'}</Text>
        </View>
        {access.data?.isAdmin ? (
          <Pressable onPress={() => router.push('/association/admin')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Admin console">
            <ShieldCheck size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.push('/association/profile')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="My profile">
          <UserRound size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Pressable onPress={() => router.push('/association/notifications')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Notifications">
          <Bell size={20} color={Colors.onSurface} strokeWidth={2} />
          {(dash.data?.unreadAnnouncements ?? 0) > 0 ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>

      {dash.isLoading ? (
        <StateView kind="loading" message="Loading your dashboard…" />
      ) : dash.isError || !dash.data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => dash.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Greeting */}
          <Text style={styles.greeting}>Hello, {dash.data.card.fullName.split(' ').slice(-1)[0]} 👋</Text>

          {/* Membership card (no QR here; full QR on /card) */}
          <Pressable onPress={() => router.push('/association/card')} accessibilityLabel="Open membership card">
            <MembershipCardView card={dash.data.card} showQr={false} />
          </Pressable>

          {/* Restriction banner */}
          {dash.data.restriction ? (
            <Pressable style={styles.restrictBanner} onPress={() => router.push('/association/edge/payment-required')}>
              <AlertTriangle size={18} color={Colors.error} strokeWidth={2} />
              <Text style={styles.restrictText}>{dash.data.restriction.reason}</Text>
              <ChevronRight size={16} color={Colors.error} strokeWidth={2} />
            </Pressable>
          ) : null}

          {/* Outstanding dues */}
          <Pressable style={[styles.duesCard, shadow1]} onPress={() => router.push('/association/dues')}>
            <View style={{ flex: 1 }}>
              <Text style={styles.duesLabel}>Outstanding dues</Text>
              <Text style={styles.duesAmount}>{formatNaira(dash.data.outstandingKobo)}</Text>
              {dash.data.nextDueDate ? <Text style={styles.duesDue}>{dueLabel(dash.data.nextDueDate)}</Text> : null}
            </View>
            <View style={styles.payChip}>
              <Text style={styles.payChipText}>Pay</Text>
            </View>
          </Pressable>

          {/* Quick actions */}
          <QuickNav />

          {/* Next meeting */}
          {dash.data.nextMeeting ? (
            <>
              <SectionHeader title="Next meeting" actionLabel="All" onAction={() => router.push('/association/meetings')} style={styles.sectionGap} />
              <Pressable style={[styles.infoCard, shadow1]} onPress={() => router.push(`/association/meetings/${dash.data!.nextMeeting!.id}`)} accessibilityRole="button" accessibilityLabel="Open next meeting">
                <View style={styles.infoIcon}><CalendarDays size={18} color={Colors.secondary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoTitle} numberOfLines={2}>{dash.data.nextMeeting.title}</Text>
                  <Text style={styles.infoSub}>{formatDateTime(dash.data.nextMeeting.startsAt)}</Text>
                  {dash.data.nextMeeting.location ? <Text style={styles.infoSub}>{dash.data.nextMeeting.location}</Text> : null}
                </View>
                <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            </>
          ) : null}

          {/* Latest announcement */}
          {dash.data.latestAnnouncement ? (
            <>
              <SectionHeader title="Announcements" actionLabel="All" onAction={() => router.push('/association/announcements')} style={styles.sectionGap} />
              <Pressable style={[styles.infoCard, shadow1]} onPress={() => router.push(`/association/announcements/${dash.data!.latestAnnouncement!.id}`)} accessibilityRole="button" accessibilityLabel="Open latest announcement">
                <View style={[styles.infoIcon, dash.data.latestAnnouncement.urgent && styles.infoIconUrgent]}>
                  <Megaphone size={18} color={dash.data.latestAnnouncement.urgent ? Colors.error : Colors.primary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoTitle} numberOfLines={2}>{dash.data.latestAnnouncement.title}</Text>
                  <Text style={styles.infoSub}>{relativeTime(dash.data.latestAnnouncement.postedAt)}</Text>
                </View>
                <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            </>
          ) : null}

          {/* Open tasks */}
          <Pressable style={[styles.tasksRow, shadow1]} onPress={() => router.push('/association/tasks')} accessibilityRole="button" accessibilityLabel="View your tasks">
            <ListTodo size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.tasksText}>{dash.data.openTasks} open task{dash.data.openTasks === 1 ? '' : 's'} assigned to you</Text>
            <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.error },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md },
  greeting: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  restrictBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md,
  },
  restrictText: { ...Typography.labelMd, color: Colors.error, flex: 1 },
  duesCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  duesLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  duesAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  duesDue: { ...Typography.labelSm, color: Colors.gold, marginTop: 2 },
  payChip: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  payChipText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  sectionGap: { marginTop: Spacing.sm, marginBottom: 0, paddingHorizontal: 0 },
  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  infoIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  infoIconUrgent: { backgroundColor: Colors.errorContainer },
  infoTitle: { ...Typography.labelLg, color: Colors.onSurface },
  infoSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tasksRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.sm,
  },
  tasksText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
