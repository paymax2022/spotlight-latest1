import React, { useMemo, useState } from 'react';
import { View, Text, Image, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BadgeCheck, ChevronRight, MessageCircle, UserPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useInbox, useRequests } from '@/features/connect/messaging/hooks';
import type { InboxThread, ConnectionRequest } from '@/features/connect/messaging/types';

// MS-01 — Messages inbox. Two tabs: Chats (active threads) | Requests (count).
// Date rows whose gate !== 'matched' are visually muted ("Match to chat") but
// still open the thread — thread.tsx hard-locks the composer (§4).

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.round(d / 7)}w`;
}

const TABS = [
  { value: 'chats', label: 'Chats' },
  { value: 'requests', label: 'Requests' },
] as const;

type Tab = (typeof TABS)[number]['value'];

function ModeTag({ mode }: { mode: InboxThread['mode'] }) {
  const label = mode === 'date' ? 'Date' : mode === 'network' ? 'Network' : 'Discover';
  return (
    <View style={styles.modeTag}>
      <Text style={styles.modeTagText}>{label}</Text>
    </View>
  );
}

function ChatRow({ thread }: { thread: InboxThread }) {
  const muted = thread.mode === 'date' && thread.gate !== 'matched';
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/connect/messaging/thread?threadId=${thread.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open chat with ${thread.peerName}`}
    >
      <View style={styles.avatarWrap}>
        {thread.peerAvatar ? (
          <Image source={{ uri: thread.peerAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{thread.peerName.charAt(0)}</Text>
          </View>
        )}
        {thread.peerOnline ? <View style={styles.onlineDot} /> : null}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <View style={styles.nameWrap}>
            <Text style={styles.name} numberOfLines={1}>{thread.peerName}</Text>
            {thread.peerVerified ? <BadgeCheck size={15} color={ConnectColors.ok} strokeWidth={2.4} /> : null}
          </View>
          {thread.lastAt ? <Text style={styles.time}>{relativeTime(thread.lastAt)}</Text> : null}
        </View>

        <View style={styles.rowBottom}>
          <ModeTag mode={thread.mode} />
          {muted ? (
            <Text style={styles.mutedPreview} numberOfLines={1}>Match to chat</Text>
          ) : (
            <Text style={styles.preview} numberOfLines={1}>
              {thread.lastMessage ?? 'Say hello!'}
            </Text>
          )}
          {thread.unread > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{thread.unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesInbox() {
  const [tab, setTab] = useState<Tab>('chats');
  const inbox = useInbox();
  const requests = useRequests();

  const requestCount = requests.data?.length ?? 0;

  const tabOptions = useMemo(
    () => [
      { value: 'chats', label: 'Chats' },
      { value: 'requests', label: requestCount > 0 ? `Requests (${requestCount})` : 'Requests' },
    ],
    [requestCount],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Messages" />

      <View style={styles.segWrap}>
        <SegmentedControl options={tabOptions} value={tab} onChange={(v) => setTab(v as Tab)} />
      </View>

      {tab === 'chats' ? (
        inbox.isLoading ? (
          <StateView kind="loading" message="Loading conversations…" />
        ) : inbox.error ? (
          <StateView
            kind="error"
            icon="CloudOff"
            title="Could not load messages"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => inbox.refetch()}
          />
        ) : !inbox.data || inbox.data.length === 0 ? (
          <StateView
            kind="empty"
            icon="MessageCircle"
            title="No conversations yet"
            message="When you match or connect, your chats will appear here."
          />
        ) : (
          <FlatList
            data={inbox.data}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => <ChatRow thread={item} />}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />
        )
      ) : (
        <RequestsTab requests={requests} />
      )}
    </SafeAreaView>
  );
}

function RequestsTab({ requests }: { requests: ReturnType<typeof useRequests> }) {
  if (requests.isLoading) return <StateView kind="loading" message="Loading requests…" />;
  if (requests.error) {
    return (
      <StateView
        kind="error"
        icon="CloudOff"
        title="Could not load requests"
        message="Check your connection and try again."
        actionLabel="Retry"
        onAction={() => requests.refetch()}
      />
    );
  }
  const data = requests.data ?? [];
  if (data.length === 0) {
    return (
      <StateView
        kind="empty"
        icon="UserPlus"
        title="No pending requests"
        message="Connection and message requests will show up here."
      />
    );
  }
  return (
    <FlatList
      data={data}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => <RequestPreviewRow request={item} />}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListHeaderComponent={
        <Pressable
          style={styles.manageRow}
          onPress={() => router.push('/connect/messaging/connection-requests')}
        >
          <UserPlus size={18} color={ConnectColors.brand} strokeWidth={2} />
          <Text style={styles.manageText}>Review all connection requests</Text>
          <ChevronRight size={18} color={ConnectColors.muted} />
        </Pressable>
      }
    />
  );
}

function RequestPreviewRow({ request }: { request: ConnectionRequest }) {
  const target = request.kind === 'connect' ? '/connect/messaging/connection-requests' : '/connect/messaging/requests';
  return (
    <Pressable style={styles.row} onPress={() => router.push(target)}>
      <View style={styles.avatarWrap}>
        {request.fromAvatar ? (
          <Image source={{ uri: request.fromAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{request.fromName.charAt(0)}</Text>
          </View>
        )}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.nameWrap}>
          <Text style={styles.name} numberOfLines={1}>{request.fromName}</Text>
          {request.verified ? <BadgeCheck size={15} color={ConnectColors.ok} strokeWidth={2.4} /> : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {request.kind === 'connect' ? 'Wants to connect' : 'Wants to message you'}
          {request.note ? ` · ${request.note}` : ''}
        </Text>
      </View>
      <ChevronRight size={18} color={ConnectColors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingBottom: Spacing.sm },
  listContent: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  avatarWrap: { width: 52, height: 52 },
  avatar: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  onlineDot: {
    position: 'absolute', right: 0, bottom: 2, width: 13, height: 13, borderRadius: Radius.full,
    backgroundColor: ConnectColors.ok, borderWidth: 2, borderColor: Colors.background,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  time: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginLeft: Spacing.sm },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  modeTag: { backgroundColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  modeTagText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  mutedPreview: { ...Typography.bodySm, color: Colors.outline, fontStyle: 'italic', flex: 1 },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: Radius.full, backgroundColor: ConnectColors.brand,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  unreadText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' },
  manageRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, marginBottom: Spacing.sm,
  },
  manageText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
});
