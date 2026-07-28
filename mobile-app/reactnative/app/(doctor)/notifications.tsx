import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, Check, CheckCheck, Settings2, ChevronRight } from 'lucide-react-native';
import * as Icons from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView } from '@/features/doctor/components';
import {
  useNotificationFeed,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/features/doctor/hooks';
import {
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_CATEGORY_ICONS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_SEVERITY_TONES,
} from '@/features/doctor/constants';
import type { RichNotification, NotificationFilter, NotificationCategory } from '@/types/doctor.batch6';

const FILTERS: { value: NotificationFilter; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'clinical', label: 'Clinical' },
  { value: 'earnings', label: 'Earnings' },
  { value: 'compliance', label: 'Compliance' },
];

export default function DoctorNotificationsScreen() {
  const { data: notifications = [], isLoading, isError, refetch } = useNotificationFeed();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [filter, setFilter] = useState<NotificationFilter>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    if (filter === 'unread') return notifications.filter((n) => !n.read);
    return notifications.filter((n) => n.category === filter);
  }, [notifications, filter]);

  // Group filtered notifications by category for the grouped centre view.
  const groups = useMemo(() => {
    const order: NotificationCategory[] = ['appointments', 'messages', 'clinical', 'pharmacy', 'hmo', 'earnings', 'compliance', 'reputation', 'support'];
    return order
      .map((cat) => ({ cat, items: filtered.filter((n) => n.category === cat) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handlePress = async (n: RichNotification) => {
    if (!n.read) { try { await markRead.mutateAsync({ notificationId: n.id }); } catch { /* inline-only */ } }
    if (n.cta?.route) router.push(n.cta.route as never);
  };

  const handleMarkAll = async () => {
    try { await markAll.mutateAsync({}); } catch { /* inline-only */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Notifications" />

      {isLoading && notifications.length === 0 ? (
        <StateView variant="loading" label="Loading notifications" />
      ) : isError ? (
        <StateView variant="error" message="We could not load notifications." onRetry={() => refetch()} />
      ) : (
        <>
          {/* Toolbar: filters + actions */}
          <View style={styles.toolbar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {FILTERS.map((f) => {
                const active = filter === f.value;
                return (
                  <Pressable
                    key={f.value}
                    onPress={() => setFilter(f.value)}
                    style={[styles.chip, active && styles.chipActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter ${f.label}`}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {f.label}{f.value === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <View style={styles.actions}>
            <Pressable onPress={handleMarkAll} disabled={markAll.isPending || unreadCount === 0} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Mark all as read">
              <CheckCheck size={16} color={unreadCount === 0 ? Colors.onSurfaceVariant : Colors.primary} strokeWidth={2} />
              <Text style={[styles.actionText, unreadCount === 0 && styles.actionMuted]}>Mark all read</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/(doctor)/notifications/preferences')} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Notification preferences">
              <Settings2 size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.actionText}>Preferences</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {filtered.length === 0 ? (
              <StateView variant="empty" icon={Bell} title="No notifications" message="You're all caught up." />
            ) : (
              groups.map((g) => (
                <View key={g.cat} style={styles.group}>
                  <Text style={styles.groupTitle}>{NOTIFICATION_CATEGORY_LABELS[g.cat]}</Text>
                  <View style={styles.list}>
                    {g.items.map((n) => (
                      <RichNotificationRow key={n.id} notification={n} onPress={() => handlePress(n)} onMarkRead={() => markRead.mutate({ notificationId: n.id })} />
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

function RichNotificationRow({ notification: n, onPress, onMarkRead }: { notification: RichNotification; onPress: () => void; onMarkRead: () => void }) {
  const iconName = NOTIFICATION_CATEGORY_ICONS[n.category];
  const Icon = mapIcon(n.kind, iconName);
  const tone = NOTIFICATION_SEVERITY_TONES[n.severity];
  const critical = n.severity === 'critical';
  const time = new Date(n.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !n.read && styles.rowUnread, critical && styles.rowCritical, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={n.title}
    >
      <View style={[styles.iconBox, { backgroundColor: `${tone}1A` }]}>
        <Icon size={20} color={tone} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{n.title}</Text>
          {critical && (
            <View style={[styles.sevTag, { backgroundColor: tone }]}>
              <Text style={styles.sevText}>Critical</Text>
            </View>
          )}
        </View>
        <Text style={styles.text} numberOfLines={2}>{n.body}</Text>
        <Text style={styles.kind}>{NOTIFICATION_KIND_LABELS[n.kind]}</Text>
        {!!n.cta && (
          <View style={styles.ctaRow}>
            <Text style={styles.ctaLabel}>{n.cta.label}</Text>
            <ChevronRight size={14} color={Colors.primary} strokeWidth={2.4} />
          </View>
        )}
      </View>
      <View style={styles.right}>
        <Text style={styles.time}>{time}</Text>
        {!n.read ? (
          <Pressable onPress={onMarkRead} hitSlop={10} accessibilityRole="button" accessibilityLabel="Mark as read">
            <Check size={16} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

// Resolve a lucide icon for a notification kind, falling back to the category
// Ionicons-style hint mapped to lucide.
function mapIcon(kind: RichNotification['kind'], _categoryHint: string): LucideIcon {
  const byKind: Partial<Record<RichNotification['kind'], LucideIcon>> = {
    new_appointment:       Icons.CalendarPlus,
    appointment_cancelled: Icons.CalendarX,
    patient_waiting:       Icons.Clock,
    new_chat_message:      Icons.MessageSquare,
    prescription_refill_request: Icons.RefreshCw,
    lab_result_ready:      Icons.FlaskConical,
    critical_lab_result:   Icons.Siren,
    pharmacy_substitution_request: Icons.Pill,
    drug_delivery_update:  Icons.Truck,
    hmo_approval:          Icons.ShieldCheck,
    hmo_rejection:         Icons.ShieldX,
    payout:                Icons.Wallet,
    compliance:            Icons.AlertCircle,
    licence_renewal:       Icons.BadgeCheck,
    rating_review:         Icons.Star,
    support_response:      Icons.LifeBuoy,
  };
  return byKind[kind] ?? Icons.Bell;
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  toolbar:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs },
  chips:       { gap: Spacing.sm, paddingVertical: Spacing.xs },
  chip:        { height: 34, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  chipActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:    { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '600' },
  chipTextActive:{ color: Colors.onPrimary },
  actions:     { flexDirection: 'row', gap: Spacing.lg, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText:  { ...Typography.labelMd, color: Colors.primary, fontWeight: '600' },
  actionMuted: { color: Colors.onSurfaceVariant },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs, paddingBottom: Platform.OS === 'ios' ? 40 : 24, flexGrow: 1, gap: Spacing.md },
  group:       { gap: Spacing.sm },
  groupTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  list:        { gap: Spacing.sm },
  row:         { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  rowUnread:   { backgroundColor: Colors.surfaceContainerLow },
  rowCritical: { borderColor: Colors.error },
  pressed:     { opacity: 0.85 },
  iconBox:     { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:        { flex: 1, gap: 2 },
  titleRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title:       { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  sevTag:      { height: 20, paddingHorizontal: 8, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  sevText:     { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' },
  text:        { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  kind:        { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  ctaRow:      { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: Spacing.xs },
  ctaLabel:    { ...Typography.labelMd, color: Colors.primary },
  right:       { alignItems: 'flex-end', gap: Spacing.sm },
  time:        { ...Typography.caption, color: Colors.onSurfaceVariant },
});
