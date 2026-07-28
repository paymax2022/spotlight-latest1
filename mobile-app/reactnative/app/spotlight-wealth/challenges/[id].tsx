import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Gift, Clock, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CreatorDisclaimer from '@/features/spotlightwealth/components/CreatorDisclaimer';
import { useChallenge, useJoinChallenge } from '@/features/spotlightwealth/hooks/useSpotlight';
import { CHALLENGE_KIND_META, REWARD_DISCLAIMER } from '@/features/spotlightwealth/constants/spotlight.constants';
import { formatMoney, formatEndsIn } from '@/features/spotlightwealth/utils/spotlightFormatters';

export default function ChallengeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const challenge = useChallenge(id);
  const join = useJoinChallenge();

  const data = challenge.data;
  const meta = data ? CHALLENGE_KIND_META[data.kind] : null;
  const KindIcon = meta
    ? (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.BookOpen
    : Icons.BookOpen;
  const joined = data?.joined || join.isSuccess;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Challenge" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {challenge.isLoading ? (
          <StateView kind="loading" message="Loading challenge…" />
        ) : challenge.isError || !data || !meta ? (
          <StateView kind="error" title="Couldn't load challenge" message="This challenge may no longer be available." actionLabel="Retry" onAction={() => challenge.refetch()} />
        ) : (
          <>
            <View style={[styles.card, shadow1]}>
              <View style={styles.headRow}>
                <View style={[styles.kindIcon, { backgroundColor: meta.bg }]}>
                  <KindIcon size={22} color={meta.fg} strokeWidth={2} />
                </View>
                <View style={[styles.kindChip, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.kindText, { color: meta.fg }]}>{meta.label}</Text>
                </View>
              </View>

              <Text style={styles.title}>{data.title}</Text>
              <Text style={styles.desc}>{data.description}</Text>

              <View style={styles.metaRow}>
                <Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.metaText}>{formatEndsIn(data.endsAt)}</Text>
              </View>
            </View>

            {/* Reward — explicitly framed as wallet credit */}
            <View style={[styles.rewardCard, shadow1]}>
              <View style={styles.rewardIcon}><Gift size={18} color={Colors.gold} strokeWidth={2} /></View>
              <View style={styles.flex}>
                <Text style={styles.rewardLabel}>Reward on completion</Text>
                <Text style={styles.rewardValue}>{formatMoney(data.reward)} wallet credit</Text>
              </View>
            </View>

            <View style={styles.disclaimer}>
              <CreatorDisclaimer text={REWARD_DISCLAIMER} />
            </View>

            {joined ? (
              <View style={styles.joinedBanner}>
                <CheckCircle2 size={18} color={Colors.tertiaryContainer} strokeWidth={2} />
                <Text style={styles.joinedText}>You've joined this challenge. Complete the lessons to earn your reward credit.</Text>
              </View>
            ) : (
              <View style={styles.cta}>
                <PrimaryButton
                  label="Join challenge"
                  loading={join.isPending}
                  onPress={() => join.mutate(data.id)}
                />
              </View>
            )}

            {join.isError ? (
              <Text style={styles.errorText}>Couldn't join right now. Please try again.</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  flex: { flex: 1 },
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.cardPadding,
    gap: Spacing.sm,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  kindIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  kindChip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  kindText: { ...Typography.labelSm },
  title: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  metaText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  rewardCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  rewardIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  rewardLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rewardValue: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 1 },
  disclaimer: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  joinedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md,
  },
  joinedText: { ...Typography.labelMd, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  cta: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
  errorText: { ...Typography.labelSm, color: Colors.error, textAlign: 'center', marginTop: Spacing.sm },
});
