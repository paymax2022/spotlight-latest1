import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, QrCode, History, ListChecks, ChevronRight, Bell, BarChart3, PartyPopper } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import AccessCodeCard from '@/features/visitor/components/AccessCodeCard';
import VisitEventRow from '@/features/visitor/components/VisitEventRow';
import RestrictionBanner from '@/features/visitor/components/RestrictionBanner';
import { useAccessCodes, useRestrictionStatus, useUnreadCount, useVisitHistory } from '@/features/visitor/hooks/useVisitor';
import { isActive } from '@/features/visitor/utils/visitorFormatters';

const QUICK_ACTIONS = [
  { key: 'create', label: 'Invite visitor', icon: Plus,       bg: Colors.iconBgPurple, color: Colors.primary,   route: '/visitor/create' },
  { key: 'active', label: 'Active codes',   icon: ListChecks, bg: Colors.iconBgBlue,   color: Colors.secondary, route: '/visitor/active' },
  { key: 'history',label: 'History',        icon: History,    bg: Colors.iconBgTeal,   color: Colors.teal,      route: '/visitor/history' },
] as const;

export default function VisitorDashboard() {
  const restriction = useRestrictionStatus();
  const codes = useAccessCodes();
  const history = useVisitHistory();
  const unread = useUnreadCount();

  const hardBanned = restriction.data?.state === 'hard_ban';
  const activeCodes = (codes.data ?? []).filter(isActive);
  const recent = (history.data ?? []).slice(0, 3);

  const handleCreate = () => {
    if (hardBanned) router.push('/visitor/restricted');
    else router.push('/visitor/create');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Visitors"
        subtitle="Manage gate access"
        rightSlot={
          <Pressable onPress={() => router.push('/visitor/notifications')} accessibilityRole="button" accessibilityLabel="Notifications" style={styles.bell}>
            <Bell size={22} color={Colors.onSurface} strokeWidth={1.8} />
            {(unread.data ?? 0) > 0 ? (
              <View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{(unread.data ?? 0) > 9 ? '9+' : unread.data}</Text></View>
            ) : null}
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {restriction.data ? (
          <RestrictionBanner status={restriction.data} onPress={() => router.push('/visitor/restricted')} />
        ) : null}

        {/* Quick actions */}
        <View style={styles.actionsRow}>
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            const onPress = a.key === 'create' ? handleCreate : () => router.push(a.route as never);
            return (
              <Pressable
                key={a.key}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <View style={[styles.actionIcon, { backgroundColor: a.bg }]}>
                  <Icon size={22} color={a.color} strokeWidth={1.8} />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Primary CTA */}
        <Pressable
          onPress={handleCreate}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <View style={styles.ctaIcon}>
            <QrCode size={22} color={Colors.onPrimary} strokeWidth={1.8} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Create an access code</Text>
            <Text style={styles.ctaSub}>Generate a QR + numeric code in seconds</Text>
          </View>
          <ChevronRight size={20} color={Colors.onPrimary} strokeWidth={2} />
        </Pressable>

        {/* Secondary links */}
        <View style={styles.linkRow}>
          <Pressable onPress={() => router.push('/visitor/event-guests')} accessibilityRole="button" style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}>
            <PartyPopper size={18} color={Colors.secondary} strokeWidth={1.8} />
            <Text style={styles.linkText}>Event guests</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/visitor/analytics')} accessibilityRole="button" style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}>
            <BarChart3 size={18} color={Colors.teal} strokeWidth={1.8} />
            <Text style={styles.linkText}>Analytics</Text>
          </Pressable>
        </View>

        {/* Active codes */}
        <SectionHeader
          title="Active codes"
          actionLabel={activeCodes.length ? 'See all' : undefined}
          onAction={() => router.push('/visitor/active')}
          style={styles.section}
        />

        {codes.isLoading ? (
          <StateView kind="loading" compact message="Loading your codes…" />
        ) : codes.isError ? (
          <StateView
            kind="error"
            title="Couldn't load codes"
            message="Something went wrong. Please try again."
            actionLabel="Retry"
            onAction={() => codes.refetch()}
            compact
          />
        ) : activeCodes.length === 0 ? (
          <StateView
            kind="empty"
            icon="Ticket"
            title="No active codes"
            message="Invite a visitor to generate an access code."
            actionLabel="Invite visitor"
            onAction={handleCreate}
            compact
          />
        ) : (
          <View style={styles.list}>
            {activeCodes.slice(0, 3).map((c) => (
              <AccessCodeCard key={c.id} code={c} onPress={() => router.push(`/visitor/code/${c.id}`)} />
            ))}
          </View>
        )}

        {/* Recent activity */}
        {recent.length > 0 ? (
          <>
            <SectionHeader title="Recent activity" actionLabel="See all" onAction={() => router.push('/visitor/history')} style={styles.section} />
            <View style={styles.activityCard}>
              {recent.map((e) => (
                <VisitEventRow key={e.id} event={e} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  actionsRow: { flexDirection: 'row', gap: Spacing.md },
  action: { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm },
  pressed: { opacity: 0.8 },
  actionIcon: { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...shadow1,
  },
  ctaIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primaryContainer,
  },
  ctaTitle: { ...Typography.labelLg, color: Colors.onPrimary },
  ctaSub: { ...Typography.bodySm, color: Colors.inversePrimary },
  bell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  bellBadgeText: { ...Typography.caption, color: Colors.onError },
  linkRow: { flexDirection: 'row', gap: Spacing.md },
  linkCard: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, minHeight: 48, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerLow },
  linkText: { ...Typography.labelMd, color: Colors.onSurface },
  section: { paddingHorizontal: 0, marginTop: Spacing.sm },
  list: { gap: Spacing.sm },
  activityCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md,
    ...shadow1,
  },
});
