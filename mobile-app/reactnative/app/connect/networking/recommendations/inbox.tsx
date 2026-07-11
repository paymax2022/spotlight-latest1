import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Quote, Check, X, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import {
  useRecommendationInbox,
  useAcceptRecommendation,
  useDeclineRecommendation,
} from '@/features/connect/networking/profile/hooks';
import type { Recommendation } from '@/features/connect/networking/profile/types';

function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

/**
 * Recommendation inbox (PRD §6.5 RC-02).
 * PN-4: accept/decline is the SUBJECT's action. A recommendation only becomes
 * publicly visible after the subject accepts it — declining hides it for good.
 */
export default function RecommendationInboxScreen() {
  const query = useRecommendationInbox();
  const accept = useAcceptRecommendation();
  const decline = useDeclineRecommendation();
  const acting = accept.isPending || decline.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Recommendations" subtitle="Pending your review" />
      {query.isLoading ? (
        <StateView kind="loading" message="Loading recommendations…" />
      ) : query.isError ? (
        <StateView kind="error" icon="CloudOff" title="Couldn't load inbox" actionLabel="Retry" onAction={() => query.refetch()} />
      ) : !query.data || query.data.length === 0 ? (
        <StateView
          kind="empty"
          icon="Quote"
          title="No pending recommendations"
          message="When someone recommends you, it lands here for you to accept before it appears on your profile."
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.consentNote}>
            <ShieldAlert size={16} color={ConnectColors.brand} strokeWidth={2} />
            <Text style={styles.consentText}>
              Nothing is public until you accept. Only recommendations you accept appear on your profile.
            </Text>
          </View>

          <View style={styles.list}>
            {query.data.map((rec) => (
              <RecCard
                key={rec.id}
                rec={rec}
                busy={acting}
                onAccept={() => accept.mutate(rec.id)}
                onDecline={() => decline.mutate(rec.id)}
              />
            ))}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RecCard({
  rec,
  busy,
  onAccept,
  onDecline,
}: {
  rec: Recommendation;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{rec.authorName.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.author}>{rec.authorName}</Text>
          {rec.authorHeadline ? <Text style={styles.authorHeadline} numberOfLines={1}>{rec.authorHeadline}</Text> : null}
          {rec.relationship ? <Text style={styles.relationship}>{rec.relationship}</Text> : null}
        </View>
        <Text style={styles.date}>{relativeDate(rec.createdAt)}</Text>
      </View>

      <View style={styles.quoteRow}>
        <Quote size={16} color={ConnectColors.brand} strokeWidth={2} />
        <Text style={styles.body}>{rec.body}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.declineBtn]} onPress={onDecline} disabled={busy} accessibilityRole="button">
          <X size={16} color={Colors.error} strokeWidth={2.4} />
          <Text style={[styles.btnText, { color: Colors.error }]}>Decline</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.acceptBtn]} onPress={onAccept} disabled={busy} accessibilityRole="button">
          <Check size={16} color={Colors.onPrimary} strokeWidth={2.4} />
          <Text style={[styles.btnText, { color: Colors.onPrimary }]}>Accept & show</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  consentNote: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgPurple,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  consentText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  list: { gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
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
  date: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  quoteRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  body: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, lineHeight: 22, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: Radius.full,
  },
  declineBtn: { backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.error },
  acceptBtn: { backgroundColor: ConnectColors.brand },
  btnText: { ...Typography.labelMd, fontWeight: '700' },
});
