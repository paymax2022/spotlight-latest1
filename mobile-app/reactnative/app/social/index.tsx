import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, AtSign, Send, HandCoins, Split, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import ActivityRow from '@/features/social/components/ActivityRow';
import { useMyCashtag, useActivity } from '@/features/social/hooks';
import { SocialColors, formatNaira } from '@/features/social/constants/social.constants';

export default function SocialHome() {
  const me = useMyCashtag();
  const activity = useActivity();

  const loading = me.isLoading && activity.isLoading;
  const errored = me.isError && activity.isError;
  const noCashtag = !!me.data && !me.data.handle;

  const refetchAll = () => { me.refetch(); activity.refetch(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Paymax</Text>
          <Text style={styles.headerTitle}>Social Pay</Text>
        </View>
        <Pressable onPress={() => router.push('/social/cashtag-setup')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Cashtag settings">
          <AtSign size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      {loading ? (
        <StateView kind="loading" message="Loading your feed…" />
      ) : errored ? (
        <StateView kind="error" title="Couldn't load Social Pay" actionLabel="Retry" onAction={refetchAll} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Identity card */}
          <Pressable onPress={() => router.push('/social/cashtag-setup')} style={styles.idCard}>
            <CashtagAvatar name={me.data?.displayName} handle={me.data?.handle ?? undefined} color={me.data?.avatarColor ?? Colors.primary} size={48} verified />
            <View style={{ flex: 1 }}>
              <Text style={styles.idName}>{me.data?.displayName}</Text>
              <Text style={styles.idHandle}>{me.data?.handle ?? 'Set up your cashtag →'}</Text>
            </View>
          </Pressable>

          {noCashtag ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>Create your @cashtag so friends can pay you in one tap.</Text>
              <Pressable onPress={() => router.push('/social/cashtag-setup')}><Text style={styles.noticeAction}>Set it up</Text></Pressable>
            </View>
          ) : null}

          {/* Quick actions */}
          <View style={styles.actionsRow}>
            <QuickAction icon={Send} label="Send" onPress={() => router.push('/social/pay')} />
            <QuickAction icon={HandCoins} label="Request" onPress={() => router.push('/social/request')} />
            <QuickAction icon={Split} label="Split" onPress={() => router.push('/social/split/create')} />
            <QuickAction icon={Users} label="Pool" onPress={() => router.push('/social/pool/create')} />
          </View>

          {/* Activity */}
          <SectionHeader title="Recent activity" actionLabel="See all" onAction={() => router.push('/social/activity')} style={styles.sectionHeader} />
          {(activity.data?.length ?? 0) === 0 ? (
            <StateView kind="empty" compact title="No activity yet" message="Your sends, requests, splits and pools appear here." icon="Send" />
          ) : (
            <View style={styles.card}>
              {activity.data!.slice(0, 6).map((a) => (
                <ActivityRow key={a.id} item={a} onPress={() => router.push('/social/activity')} />
              ))}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: typeof Send; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
      <View style={styles.actionIcon}><Icon size={20} color={SocialColors.brand} strokeWidth={2} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  idCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  idName: { ...Typography.titleMd, color: Colors.onSurface },
  idHandle: { ...Typography.bodyMd, color: SocialColors.accent },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SocialColors.warnBg, borderRadius: Radius.md, padding: Spacing.md },
  noticeText: { ...Typography.bodySm, color: SocialColors.warnText, flex: 1 },
  noticeAction: { ...Typography.labelMd, color: SocialColors.warnText },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: SocialColors.surface, borderRadius: Radius.lg, paddingVertical: Spacing.md, ...shadow1 },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: SocialColors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelSm, color: SocialColors.text },
  sectionHeader: { paddingHorizontal: 0, marginTop: Spacing.sm },
  card: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.xs, ...shadow1 },
});
