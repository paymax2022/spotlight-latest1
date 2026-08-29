import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Bell, Gift, Zap, Clock, TrendingUp, CheckCircle2, XCircle, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { useQuery } from '@tanstack/react-query';
import { getVotingNotifications } from '@/features/voting/api/voting.api';
import type { VotingNotification } from '@/features/voting/types/voting.types';

const NOTIF_ICONS: Record<VotingNotification['type'], { Icon: any; color: string; bg: string }> = {
  FREE_VOTES_RESET:  { Icon: Gift,         color: '#48B8AC', bg: 'rgba(72,184,172,0.12)' },
  VOTING_LIVE:       { Icon: Zap,          color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  CONTEST_ENDING:    { Icon: Clock,        color: Colors.error, bg: Colors.errorContainer },
  RANK_CHANGED:      { Icon: TrendingUp,   color: Colors.secondary, bg: Colors.iconBgBlue },
  VOTE_SUCCESS:      { Icon: CheckCircle2, color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  PAYMENT_FAILED:    { Icon: XCircle,      color: Colors.error, bg: Colors.errorContainer },
  RESULTS_PUBLISHED: { Icon: Trophy,       color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
};

export default function VotingNotificationsScreen() {
  const { data: notifications } = useQuery({
    queryKey: ['voting', 'notifications'],
    queryFn: getVotingNotifications,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/voting')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={notifications ?? []}
        keyExtractor={(n) => n.id}
        renderItem={({ item: notif }) => {
          const cfg = NOTIF_ICONS[notif.type as keyof typeof NOTIF_ICONS] ?? NOTIF_ICONS.VOTE_SUCCESS;
          return (
            <Pressable
              style={({ pressed }) => [
                styles.card, shadow1,
                !notif.read && styles.cardUnread,
                pressed && { opacity: 0.88 },
              ]}
              onPress={() => {
                if (notif.contestId) router.push(`/voting/contest-details?contestId=${notif.contestId}`);
              }}
            >
              <View style={[styles.iconBox, { backgroundColor: cfg.bg }]}>
                <cfg.Icon size={20} color={cfg.color} strokeWidth={1.8} />
              </View>
              <View style={styles.textBlock}>
                <Text style={styles.notifTitle}>{notif.title}</Text>
                <Text style={styles.notifMsg}>{notif.message}</Text>
                <Text style={styles.notifTime}>
                  {new Date(notif.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              {!notif.read && <View style={styles.unreadDot} />}
            </Pressable>
          );
        }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Bell size={40} color={Colors.outlineVariant} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySub}>You'll be notified when contest activity happens.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:  { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:    { ...Typography.titleLg, color: Colors.onSurface },
  list:     { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 100 },
  card:     { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, position: 'relative' },
  cardUnread: { borderColor: Colors.primaryFixed },
  iconBox:  { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  textBlock: { flex: 1, gap: 3 },
  notifTitle: { ...Typography.labelMd, color: Colors.onSurface },
  notifMsg:   { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  notifTime:  { ...Typography.caption, color: Colors.outline },
  unreadDot:  { position: 'absolute', top: Spacing.md, right: Spacing.md, width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  empty:    { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.md },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  emptySub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
