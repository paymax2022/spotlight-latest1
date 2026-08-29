import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Droplets } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SprayLeaderboardRow from '@/features/social/components/spray-SprayLeaderboardRow';
import { useSprayLeaderboard, useSprayTarget } from '@/features/social/spray';
import { SocialColors } from '@/features/social/constants/social.constants';

export default function SprayLeaderboard() {
  const params = useLocalSearchParams<{ targetId?: string }>();
  const targetId = params.targetId ?? 'live_tope';
  const board = useSprayLeaderboard(targetId);
  const target = useSprayTarget(targetId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/social')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <View style={styles.headerTitleWrap}><Text style={styles.eyebrow}>Spray leaderboard</Text><Text style={styles.headerTitle} numberOfLines={1}>{target.data?.title ?? 'Live'}</Text></View>
        <View style={styles.iconBtn} />
      </View>

      {board.isLoading ? (
        <StateView kind="loading" message="Loading leaderboard…" />
      ) : board.isError ? (
        <StateView kind="error" title="Couldn't load leaderboard" actionLabel="Retry" onAction={() => board.refetch()} />
      ) : (board.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No sprays yet" message="Be the first to spray and top the board." icon="Droplets" actionLabel="Spray now" onAction={() => router.replace(`/social/spray/send?targetId=${targetId}`)} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              {board.data!.map((e) => <SprayLeaderboardRow key={e.handle} entry={e} />)}
            </View>
            <View style={{ height: 120 }} />
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label="Spray now" onPress={() => router.replace(`/social/spray/send?targetId=${targetId}`)} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  card: { backgroundColor: SocialColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.cardPadding, paddingVertical: Spacing.sm, ...shadow1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
