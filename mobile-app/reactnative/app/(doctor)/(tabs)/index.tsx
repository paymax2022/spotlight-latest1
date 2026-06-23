import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Bell, CalendarDays, Wallet, Stethoscope, ClipboardList, FlaskConical, Settings, ChevronRight, PawPrint, BarChart3,
  Inbox, Users, MessageSquare, Smile, Video, AlertTriangle, ShieldAlert, UserCog, CalendarClock, Pill, RefreshCw, BadgeCheck,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow2 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import { formatKobo } from '@/api/doctor.api';
import { useDoctorProfile, useAppointments, useEarnings, useNotifications, useUpdateSettings, useSettings, useDashboard, useAnnouncement, useSetPresence, useDismissAnnouncement } from '@/features/doctor/hooks';
import { StatCard, AppointmentRow, StateView, AlertCard, AnnouncementBanner, SectionCard } from '@/features/doctor/components';
import { DoctorAvatar } from '@/features/telemedicine/components';
import { DASHBOARD_ALERT_SEVERITY_RANK, PRESENCE_LABELS } from '@/features/doctor/constants';
import type { DashboardAlert, DashboardAlertKind, DashboardAlertSeverity } from '@/types/doctor.batch1';

const ACTIVE_STATUSES = ['upcoming', 'confirmed', 'in_progress'];

// Each alert kind maps to an icon + the in-app route its CTA deep-links to.
const ALERT_ICON: Record<DashboardAlertKind, LucideIcon> = {
  urgent_case:          AlertTriangle,
  compliance:           ShieldAlert,
  profile_completion:   UserCog,
  licence_expiry:       CalendarClock,
  new_lab_result:       FlaskConical,
  hmo_approval:         BadgeCheck,
  pending_prescription: Pill,
  refill_request:       RefreshCw,
  follow_up:            CalendarClock,
  doctor_late:          AlertTriangle,
};

const ALERT_ROUTE: Record<DashboardAlertKind, string> = {
  urgent_case:          '/(doctor)/queue',
  compliance:           '/(doctor)/compliance',
  profile_completion:   '/(doctor)/profile/setup',
  licence_expiry:       '/(doctor)/profile/licence/renew',
  new_lab_result:       '/(doctor)/prescriptions',
  hmo_approval:         '/(doctor)/claims',
  pending_prescription: '/(doctor)/prescriptions',
  refill_request:       '/(doctor)/refills',
  follow_up:            '/(doctor)/follow-ups',
  doctor_late:          '/(doctor)/queue',
};

const SEVERITY_TONE: Record<DashboardAlertSeverity, 'info' | 'warning' | 'critical'> = {
  info: 'info', warning: 'warning', critical: 'critical',
};

export default function DoctorDashboardScreen() {
  const { data: profile, isLoading: profileLoading, isError: profileError, refetch: refetchProfile } = useDoctorProfile();
  const { data: appointments = [] } = useAppointments();
  const { data: earnings } = useEarnings();
  const { data: notifications = [] } = useNotifications();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();

  // ── Section D — consolidated dashboard aggregate ──
  const { data: dashboard, isError: dashError, refetch: refetchDash } = useDashboard();
  const { data: announcement } = useAnnouncement();
  const setPresence = useSetPresence();
  const dismissAnnouncement = useDismissAnnouncement();

  const unread = notifications.filter((n) => !n.read).length;
  const todays = appointments.filter((a) => ACTIVE_STATUSES.includes(a.status));
  const isOnline = (settings?.showOnlineStatus ?? profile?.isOnline) ?? false;

  const counts = dashboard?.counts;
  const alerts: DashboardAlert[] = [...(dashboard?.alerts ?? [])].sort(
    (a, b) => DASHBOARD_ALERT_SEVERITY_RANK[b.severity] - DASHBOARD_ALERT_SEVERITY_RANK[a.severity],
  );

  const toggleOnline = () => {
    updateSettings.mutate({ settings: { showOnlineStatus: !settings?.showOnlineStatus } });
    // Mirror the presence aggregate (no idempotencyKey passed by callers).
    setPresence.mutate({ presence: isOnline ? 'offline' : 'online' });
  };

  if (profileLoading && !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView variant="loading" label="Loading your dashboard" />
      </SafeAreaView>
    );
  }

  if (profileError || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView variant="error" message="We could not load your dashboard." onRetry={() => refetchProfile()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <DoctorAvatar initials={profile.initials} color={profile.avatarColor} size={44} online={isOnline} />
          <View style={styles.headerText}>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
          </View>
        </View>
        <Pressable
          onPress={() => router.push('/(doctor)/notifications')}
          style={styles.bellWrap}
          accessibilityRole="button"
          accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}
        >
          <Bell size={22} color={Colors.onSurface} strokeWidth={1.8} />
          {unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* D19 — Platform announcement banner */}
        {announcement && (
          <View style={styles.blockGap}>
            <AnnouncementBanner
              tone={announcement.tone}
              title={announcement.title}
              body={announcement.body}
              dismissible={announcement.dismissible}
              ctaLabel={announcement.ctaLabel}
              onPress={() => router.push('/(doctor)/announcement')}
              onDismiss={() => dismissAnnouncement.mutate({ announcementId: announcement.id })}
            />
          </View>
        )}

        {/* D14 — Online status + availability presence */}
        <LinearGradient colors={[Colors.primary, Colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.statusCard, shadow2]}>
          <View style={styles.statusInfo}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.teal : Colors.outline }]} />
            <View>
              <Text style={styles.statusEyebrow}>YOU ARE</Text>
              <Text style={styles.statusValue}>
                {dashboard ? `${PRESENCE_LABELS[dashboard.presence]}${dashboard.acceptsInstant ? ' · Accepting instant' : ''}` : (isOnline ? 'Online · Accepting consults' : 'Offline')}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={toggleOnline}
            disabled={updateSettings.isPending || setPresence.isPending}
            style={[styles.statusBtn, (updateSettings.isPending || setPresence.isPending) && styles.statusBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={isOnline ? 'Go offline' : 'Go online'}
          >
            <Text style={styles.statusBtnText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
          </Pressable>
        </LinearGradient>

        {/* D1/D2/D12/D13 — Stats */}
        <View style={styles.statsRow}>
          <StatCard icon={CalendarDays} label="Today's consults" value={String(counts?.todaysAppointments ?? todays.length)} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
          <StatCard icon={CalendarClock} label="Upcoming" value={String(counts?.upcomingAppointments ?? 0)} iconColor={Colors.primary} bgColor={Colors.iconBgPurple} />
        </View>
        <View style={styles.statsRow}>
          <StatCard icon={Wallet} label="Available" value={formatKobo(dashboard?.earnings.availableKobo ?? earnings?.availableKobo ?? 0)} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} />
          <StatCard icon={Smile} label="Satisfaction" value={`${dashboard?.satisfactionPct ?? 0}%`} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
        </View>

        {/* D4 — Active consultation card */}
        {dashboard?.activeConsultation && (
          <Pressable
            style={[styles.activeCard, shadow2]}
            onPress={() => router.push(`/(doctor)/appointments/${dashboard.activeConsultation!.appointmentId}`)}
            accessibilityRole="button"
            accessibilityLabel="Active consultation"
          >
            <View style={styles.activeIcon}>
              <Video size={20} color={Colors.onPrimary} strokeWidth={2} />
            </View>
            <View style={styles.activeBody}>
              <Text style={styles.activeEyebrow}>LIVE CONSULTATION</Text>
              <Text style={styles.activeName} numberOfLines={1}>{dashboard.activeConsultation.patientName}</Text>
              <Text style={styles.activeMeta} numberOfLines={1}>{dashboard.activeConsultation.ref} · in progress</Text>
            </View>
            <ChevronRight size={20} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>
        )}

        {/* D3/D5/D7 — Live queues summary */}
        {counts && (counts.pendingRequests > 0 || counts.waitingRoom > 0 || counts.unreadMessages > 0) && (
          <View style={styles.quickStats}>
            <Pressable style={styles.quickStat} onPress={() => router.push('/(doctor)/appointments/requests')} accessibilityRole="button" accessibilityLabel="Pending requests">
              <Inbox size={18} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.quickStatValue}>{counts.pendingRequests}</Text>
              <Text style={styles.quickStatLabel}>Requests</Text>
            </Pressable>
            <Pressable style={styles.quickStat} onPress={() => router.push('/(doctor)/queue/waiting-room')} accessibilityRole="button" accessibilityLabel="Waiting room">
              <Users size={18} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.quickStatValue}>{counts.waitingRoom}</Text>
              <Text style={styles.quickStatLabel}>Waiting</Text>
            </Pressable>
            <Pressable style={styles.quickStat} onPress={() => router.push('/(doctor)/(tabs)/messages')} accessibilityRole="button" accessibilityLabel="Unread messages">
              <MessageSquare size={18} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.quickStatValue}>{counts.unreadMessages}</Text>
              <Text style={styles.quickStatLabel}>Messages</Text>
            </Pressable>
          </View>
        )}

        {/* D6/D8–D11/D15–D18/D20 — Alerts (the DashboardAlert union) */}
        {dashError ? (
          <View style={styles.blockGap}>
            <StateView variant="error" message="We could not load your alerts." onRetry={() => refetchDash()} />
          </View>
        ) : alerts.length > 0 ? (
          <>
            <SectionHeader title="Needs attention" style={styles.sectionGap} />
            <View style={styles.list}>
              {alerts.map((a) => (
                <AlertCard
                  key={a.id}
                  icon={ALERT_ICON[a.kind]}
                  tone={SEVERITY_TONE[a.severity]}
                  title={a.title}
                  body={a.body}
                  count={a.count}
                  ctaLabel={a.cta?.label ?? 'View'}
                  onPress={() => router.push(ALERT_ROUTE[a.kind] as never)}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* D7 — Unread patient messages preview */}
        {dashboard && dashboard.messages.length > 0 && (
          <>
            <SectionHeader title="Recent messages" actionLabel="See all" onAction={() => router.push('/(doctor)/(tabs)/messages')} style={styles.sectionGap} />
            <SectionCard style={styles.card}>
              {dashboard.messages.map((m, i) => (
                <Pressable
                  key={m.threadId}
                  style={[styles.msgRow, i > 0 && styles.msgBorder]}
                  onPress={() => router.push('/(doctor)/(tabs)/messages')}
                  accessibilityRole="button"
                  accessibilityLabel={`Message from ${m.patientName}`}
                >
                  <DoctorAvatar initials={m.initials} color={m.avatarColor} size={40} />
                  <View style={styles.msgBody}>
                    <Text style={styles.msgName} numberOfLines={1}>{m.patientName}</Text>
                    <Text style={styles.msgSnippet} numberOfLines={1}>{m.snippet}</Text>
                  </View>
                  {m.unread && <View style={styles.msgDot} />}
                </Pressable>
              ))}
            </SectionCard>
          </>
        )}

        {/* Quick actions */}
        <SectionHeader title="Quick actions" style={styles.sectionGap} />
        <View style={styles.actionsGrid}>
          <QuickAction icon={CalendarDays} label="Schedule" color={Colors.secondary} bg={Colors.iconBgBlue} onPress={() => router.push('/(doctor)/availability')} />
          <QuickAction icon={Inbox} label="Queue" color={Colors.primary} bg={Colors.iconBgPurple} onPress={() => router.push('/(doctor)/queue')} />
          <QuickAction icon={ClipboardList} label="Prescriptions" color={Colors.teal} bg={Colors.iconBgTeal} onPress={() => router.push('/(doctor)/prescriptions')} />
          <QuickAction icon={Settings} label="Settings" color={Colors.onSurfaceVariant} bg={Colors.surfaceContainerLow} onPress={() => router.push('/(doctor)/settings')} />
        </View>

        {/* Phase 3 entry points */}
        <View style={styles.phase3Row}>
          <Pressable style={styles.phase3Link} onPress={() => router.push('/(doctor)/vet')} accessibilityRole="button" accessibilityLabel="Veterinary mode">
            <View style={[styles.phase3Icon, { backgroundColor: Colors.iconBgPurple }]}>
              <PawPrint size={18} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.phase3Label} numberOfLines={1}>Vet mode</Text>
            <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
          <Pressable style={styles.phase3Link} onPress={() => router.push('/(doctor)/analytics')} accessibilityRole="button" accessibilityLabel="Quality analytics">
            <View style={[styles.phase3Icon, { backgroundColor: Colors.iconBgBlue }]}>
              <BarChart3 size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <Text style={styles.phase3Label} numberOfLines={1}>Analytics</Text>
            <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        </View>

        {/* Today's queue */}
        <SectionHeader title="Today's queue" actionLabel="See all" onAction={() => router.push('/(doctor)/(tabs)/appointments')} style={styles.sectionGap} />
        <View style={styles.list}>
          {todays.length === 0 ? (
            <StateView variant="empty" icon={CalendarDays} title="No consults scheduled" message="New bookings will appear here." />
          ) : (
            todays.map((a) => (
              <AppointmentRow key={a.id} appointment={a} onPress={() => router.push(`/(doctor)/appointments/${a.id}`)} />
            ))
          )}
        </View>

        {/* Verification banner */}
        {profile.verification !== 'approved' && (
          <Pressable style={styles.verifyBanner} onPress={() => router.push('/(doctor)/signup/pending')}>
            <Text style={styles.verifyText}>Your verification is {profile.verification}. Tap to view status.</Text>
            <ChevronRight size={18} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon: Icon, label, color, bg, onPress }: { icon: LucideIcon; label: string; color: string; bg: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.actionIcon, { backgroundColor: bg }]}>
        <Icon size={22} color={color} strokeWidth={2} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  headerText:    { flex: 1 },
  greeting:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  name:          { ...Typography.titleMd, color: Colors.onSurface },
  bellWrap:      { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  badge:         { position: 'absolute', top: 8, right: 8, minWidth: 16, height: 16, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText:     { ...Typography.caption, color: Colors.onError },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  blockGap:      { marginBottom: Spacing.md },
  statusCard:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Radius.xl, padding: Spacing.cardPadding, marginBottom: Spacing.lg },
  statusInfo:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  statusDot:     { width: 10, height: 10, borderRadius: Radius.full },
  statusEyebrow: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  statusValue:   { ...Typography.labelLg, color: Colors.onPrimary },
  statusBtn:     { height: 40, paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  statusBtnDisabled: { opacity: 0.5 },
  statusBtnText: { ...Typography.labelMd, color: Colors.onPrimary },
  statsRow:      { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  activeCard:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, backgroundColor: Colors.tertiaryContainer },
  activeIcon:    { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  activeBody:    { flex: 1, gap: 2 },
  activeEyebrow: { ...Typography.labelSm, color: Colors.tertiaryFixed },
  activeName:    { ...Typography.labelLg, color: Colors.onPrimary },
  activeMeta:    { ...Typography.caption, color: 'rgba(255,255,255,0.8)' },
  quickStats:    { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  quickStat:     { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  quickStatValue:{ ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
  quickStatLabel:{ ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionGap:    { marginTop: Spacing.md, paddingHorizontal: 0 },
  card:          { marginTop: 0 },
  msgRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  msgBorder:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  msgBody:       { flex: 1, gap: 2 },
  msgName:       { ...Typography.labelMd, color: Colors.onSurface },
  msgSnippet:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  msgDot:        { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: Colors.secondary },
  actionsGrid:   { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  action:        { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm },
  actionIcon:    { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  actionLabel:   { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  list:          { gap: Spacing.sm },
  phase3Row:     { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  phase3Link:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  phase3Icon:    { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  phase3Label:   { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  verifyBanner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.secondary },
  verifyText:    { ...Typography.labelMd, color: Colors.onPrimary, flex: 1 },
});
