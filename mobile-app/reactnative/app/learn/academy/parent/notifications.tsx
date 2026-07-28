import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, FileText, AlertCircle, CreditCard, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useParentNotifications } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';

const META: Record<string, { Icon: typeof FileText; color: string; bg: string; href?: string }> = {
  approval: { Icon: ShieldCheck, color: Colors.primary, bg: Colors.iconBgPurple, href: '/learn/academy/parent/approvals' },
  report: { Icon: FileText, color: Colors.secondary, bg: Colors.iconBgBlue, href: '/learn/academy/parent/reports' },
  alert: { Icon: AlertCircle, color: Colors.error, bg: Colors.errorContainer },
  billing: { Icon: CreditCard, color: Colors.onWarning, bg: Colors.iconBgGold, href: '/learn/academy/parent/billing' },
  edupay: { Icon: Wallet, color: Colors.teal, bg: Colors.iconBgTeal, href: '/learn/academy/parent/edupay' },
};

/** P13 — Parent notifications: alerts, reports, approvals, billing & EduPay reminders. */
export default function ParentNotifications() {
  const notifications = useParentNotifications();

  if (notifications.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading notifications…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {notifications.data?.length ? notifications.data.map((n) => {
          const m = META[n.kind] ?? META.alert;
          return (
            <Pressable key={n.id} style={[styles.row, shadow1, !n.read && styles.unread]} onPress={() => m.href && router.push(m.href as never)}>
              <View style={[styles.icon, { backgroundColor: m.bg }]}><m.Icon size={18} color={m.color} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{n.title}</Text>
                <Text style={styles.body}>{n.body}</Text>
                <Text style={styles.ts}>{formatDate(n.ts)}</Text>
              </View>
              {!n.read ? <View style={styles.dot} /> : null}
            </Pressable>
          );
        }) : (
          <StateView kind="empty" icon="Bell" title="No notifications" message="You’re all caught up." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  unread: { backgroundColor: Colors.surfaceContainerLow },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  ts: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6 },
});
