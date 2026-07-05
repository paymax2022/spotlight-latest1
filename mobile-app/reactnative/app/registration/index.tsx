import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Trophy, Banknote, MapPin, ClipboardList } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useContests, useStartDraft } from '@/features/registration/hooks/useRegistration';
import type { ContestRegistrationDefinition } from '@/features/registration/types/registration.types';

export default function RegistrationHomeScreen() {
  const contests = useContests();
  const startDraft = useStartDraft();

  const onStart = (slug: string) => {
    startDraft.mutate(slug, {
      onSuccess: (draft) => router.push(`/registration/${draft.id}/wizard` as never),
      onError: () => Alert.alert('Could not start', 'We could not start your application. Please try again.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Register / Apply"
        subtitle="Enter a Spotlight contest"
        rightSlot={
          <Pressable onPress={() => router.push('/registration/applications' as never)} hitSlop={10} accessibilityLabel="My applications">
            <ClipboardList size={22} color={Colors.onSurface} />
          </Pressable>
        }
      />

      {contests.isLoading ? (
        <StateView kind="loading" message="Loading open contests…" />
      ) : contests.isError ? (
        <StateView kind="error" title="Couldn’t load contests" message="Please check your connection and try again." actionLabel="Retry" onAction={() => contests.refetch()} />
      ) : (contests.data ?? []).length === 0 ? (
        <StateView kind="empty" title="No open contests" message="There are no contests open for registration right now. Check back soon." />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={contests.isRefetching} onRefresh={contests.refetch} tintColor={Colors.primary} />}
        >
          <Pressable style={styles.myAppsBanner} onPress={() => router.push('/registration/applications' as never)}>
            <ClipboardList size={20} color={Colors.primary} />
            <Text style={styles.myAppsText}>View my applications & status</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>

          {(contests.data ?? []).map((c) => (
            <ContestCard
              key={c.slug}
              contest={c}
              loading={startDraft.isPending && startDraft.variables === c.slug}
              onPress={() => onStart(c.slug)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ContestCard({ contest, loading, onPress }: { contest: ContestRegistrationDefinition; loading: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.card, shadow1]} onPress={onPress} disabled={loading}>
      <View style={styles.cardIcon}>
        <Trophy size={22} color={Colors.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{contest.title}</Text>
        <Text style={styles.cardMeta}>{contest.seasonOrEdition} · {contest.regionScope}</Text>
        <View style={styles.cardTags}>
          <View style={styles.tag}>
            <Banknote size={13} color={Colors.onSurfaceVariant} />
            <Text style={styles.tagText}>{contest.isPaid ? `₦${(contest.registrationFeeNgn ?? 0).toLocaleString('en-NG')}` : 'Free'}</Text>
          </View>
          <View style={styles.tag}>
            <MapPin size={13} color={Colors.onSurfaceVariant} />
            <Text style={styles.tagText}>{(contest.auditionStates?.length ?? 0) > 0 ? `${contest.auditionStates!.length} states` : 'Online'}</Text>
          </View>
        </View>
      </View>
      <ChevronRight size={20} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  myAppsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.md,
  },
  myAppsText: { ...Typography.labelLg, color: Colors.onPrimaryFixed, flex: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.iconBgGold,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, textTransform: 'capitalize' },
  cardTags: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  tagText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
