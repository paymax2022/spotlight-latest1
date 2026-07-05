import React from 'react';
import { View, Text, Image, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BadgeCheck, UserPlus, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useRequests, useRespondToRequest } from '@/features/connect/messaging/hooks';
import type { ConnectionRequest } from '@/features/connect/messaging/types';

// Connection requests — incoming request-to-connect (kind === 'connect',
// Network mode, with a note §5). Pending requests are NOT threads; ACCEPTING
// one is the only way it becomes a messageable thread.

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function ConnectCard({ request }: { request: ConnectionRequest }) {
  const respond = useRespondToRequest();

  const onAccept = () =>
    respond.mutate(
      { requestId: request.id, accept: true },
      {
        onSuccess: (res) => {
          if (res.threadId) {
            router.push(`/connect/messaging/thread?threadId=${res.threadId}`);
          }
        },
      },
    );
  const onDecline = () => respond.mutate({ requestId: request.id, accept: false });

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        {request.fromAvatar ? (
          <Image source={{ uri: request.fromAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{request.fromName.charAt(0)}</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{request.fromName}</Text>
            {request.verified ? <BadgeCheck size={15} color={ConnectColors.ok} strokeWidth={2.4} /> : null}
          </View>
          <View style={styles.metaRow}>
            {typeof request.mutualConnections === 'number' ? (
              <Text style={styles.meta}>{request.mutualConnections} mutual</Text>
            ) : null}
            <View style={styles.timeRow}>
              <Clock size={12} color={ConnectColors.muted} strokeWidth={2} />
              <Text style={styles.meta}>{relativeTime(request.createdAt)}</Text>
            </View>
          </View>
        </View>
      </View>

      {request.note ? (
        <View style={styles.noteCard}>
          <Text style={styles.noteText}>“{request.note}”</Text>
        </View>
      ) : null}

      {respond.error ? (
        <Text style={styles.errorText}>Could not update this request. Try again.</Text>
      ) : null}

      <View style={styles.actions}>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Decline" variant="ghost" onPress={onDecline} disabled={respond.isPending} />
        </View>
        <View style={styles.actionHalf}>
          <PrimaryButton label="Accept" onPress={onAccept} loading={respond.isPending} />
        </View>
      </View>
    </View>
  );
}

export default function ConnectionRequests() {
  const { data, isLoading, error, refetch } = useRequests();
  const connectRequests = (data ?? []).filter((r) => r.kind === 'connect');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Connection requests" />

      {isLoading ? (
        <StateView kind="loading" message="Loading requests…" />
      ) : error ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Could not load requests"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : connectRequests.length === 0 ? (
        <StateView
          kind="empty"
          icon="UserPlus"
          title="No pending requests"
          message="When someone asks to connect, their request will appear here."
        />
      ) : (
        <FlatList
          data={connectRequests}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ConnectCard request={item} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  cardBody: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  noteCard: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md,
    borderLeftWidth: 3, borderLeftColor: ConnectColors.brand,
  },
  noteText: { ...Typography.bodySm, color: Colors.onSurface, fontStyle: 'italic' },
  errorText: { ...Typography.labelSm, color: Colors.error },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionHalf: { flex: 1 },
});
