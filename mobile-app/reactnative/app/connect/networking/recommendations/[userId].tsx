import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Quote, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useUserRecommendations } from '@/features/connect/networking/profile/hooks';
import type { Recommendation } from '@/features/connect/networking/profile/types';

/**
 * Public recommendations on a profile (PRD §6.5 RC-03).
 * PN-4: this list is ACCEPTED-ONLY — the API never returns drafted/sent/declined
 * recommendations. The subject's consent (accept) is what makes them appear here.
 */
export default function PublicRecommendationsScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const id = String(userId ?? 'me');
  const query = useUserRecommendations(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Recommendations" />
      {query.isLoading ? (
        <StateView kind="loading" message="Loading recommendations…" />
      ) : query.isError ? (
        <StateView kind="error" icon="CloudOff" title="Couldn't load recommendations" actionLabel="Retry" onAction={() => query.refetch()} />
      ) : !query.data || query.data.length === 0 ? (
        <StateView
          kind="empty"
          icon="Quote"
          title="No recommendations yet"
          message="Accepted recommendations appear here for everyone to see."
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.badgeRow}>
            <BadgeCheck size={15} color={ConnectColors.ok} strokeWidth={2.2} />
            <Text style={styles.badgeText}>Only recommendations the member accepted are shown.</Text>
          </View>
          <View style={styles.list}>
            {query.data.map((rec) => (
              <RecCard key={rec.id} rec={rec} />
            ))}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RecCard({ rec }: { rec: Recommendation }) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{rec.authorName.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.author}>{rec.authorName}</Text>
          {rec.authorHeadline ? <Text style={styles.authorHeadline} numberOfLines={1}>{rec.authorHeadline}</Text> : null}
          {rec.relationship ? <Text style={styles.relationship}>{rec.relationship}</Text> : null}
        </View>
      </View>
      <View style={styles.quoteRow}>
        <Quote size={16} color={ConnectColors.brand} strokeWidth={2} />
        <Text style={styles.body}>{rec.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.md },
  badgeText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  list: { gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  avatarInitial: { ...Typography.titleMd, color: ConnectColors.brand, fontWeight: '700' },
  author: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  authorHeadline: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  relationship: { ...Typography.caption, color: ConnectColors.brand, marginTop: 2 },
  quoteRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  body: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, lineHeight: 22, fontStyle: 'italic' },
});
