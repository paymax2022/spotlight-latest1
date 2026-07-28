import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, TriangleAlert, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StatusBadge from '@/features/realtor/components/StatusBadge';
import VerificationBadge from '@/features/realtor/components/VerificationBadge';
import { getModerationQueue, decideModeration } from '@/features/realtor/api/realtorAdmin.api';
import type { ModerationDecision } from '@/features/realtor/api/realtorAdmin.api';
import { MODE_LABEL } from '@/features/realtor/constants/realtor.constants';
import { formatNairaCompact, timeAgo } from '@/features/realtor/utils/realtorFormatters';

export default function ModerationQueueScreen() {
  const qc = useQueryClient();
  const queue = useQuery({ queryKey: ['realtor-admin', 'moderation'], queryFn: getModerationQueue });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: ModerationDecision }) => decideModeration(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['realtor-admin', 'moderation'] }),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Listing moderation"
        subtitle={queue.data ? `${queue.data.length} pending review` : undefined}
      />

      {queue.isLoading ? (
        <StateView kind="loading" message="Loading the queue…" />
      ) : (queue.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="CheckCheck" title="Queue clear" message="No listings waiting for review. Nice work." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {queue.data!.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.top}>
                <Image source={{ uri: item.coverUrl }} style={styles.thumb} />
                <View style={styles.info}>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.meta}>{item.area}, {item.city} · {timeAgo(item.submittedAt)}</Text>
                  <View style={styles.badges}>
                    <StatusBadge label={MODE_LABEL[item.mode]} tone="info" />
                    <Text style={styles.price}>{formatNairaCompact(item.price)}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.ownerRow}>
                <VerificationBadge level={item.verification} />
                <View style={styles.owner}>
                  {item.ownerVerified ? <ShieldCheck size={13} color={Colors.tertiaryContainer} strokeWidth={2.2} /> : null}
                  <Text style={styles.ownerName}>{item.ownerName}</Text>
                </View>
              </View>

              {item.riskFlags.length > 0 ? (
                <View style={styles.flags}>
                  {item.riskFlags.map((f) => (
                    <View key={f} style={styles.flag}>
                      <TriangleAlert size={13} color={Colors.onWarning} strokeWidth={2.2} />
                      <Text style={styles.flagText}>{f}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.clean}>
                  <ShieldCheck size={13} color={Colors.tertiaryContainer} strokeWidth={2.2} />
                  <Text style={styles.cleanText}>No risk flags — owner & documents verified.</Text>
                </View>
              )}

              <View style={styles.actions}>
                <Pressable
                  style={[styles.actionBtn, styles.reject]}
                  onPress={() => decide.mutate({ id: item.id, decision: 'reject' })}
                  disabled={decide.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Reject listing"
                >
                  <X size={16} color={Colors.error} strokeWidth={2.4} />
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.approve]}
                  onPress={() => decide.mutate({ id: item.id, decision: 'approve' })}
                  disabled={decide.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Approve listing"
                >
                  <Check size={16} color={Colors.onPrimary} strokeWidth={2.4} />
                  <Text style={styles.approveText}>Approve & publish</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.md, ...shadow1 },
  top: { flexDirection: 'row', gap: Spacing.md },
  thumb: { width: 80, height: 80, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  info: { flex: 1, gap: 4 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  badges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  price: { ...Typography.labelMd, color: Colors.onSurface },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ownerName: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  flags: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.sm, gap: 4 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flagText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  clean: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.sm },
  cleanText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.md },
  actionBtn: { flex: 1, height: 48, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  reject: { backgroundColor: Colors.errorContainer },
  rejectText: { ...Typography.labelMd, color: Colors.error },
  approve: { backgroundColor: Colors.primary },
  approveText: { ...Typography.labelMd, color: Colors.onPrimary },
});
