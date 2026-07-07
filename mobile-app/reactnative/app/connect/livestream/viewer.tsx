import React, { useState } from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Gift, Eye, Heart, Flag, UserPlus, Swords, Send, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useLiveStream, useLiveChat, useSendLiveChat } from '@/features/connect/livestream/hooks';
import type { LiveChatMessage } from '@/features/connect/livestream/types';

/** Single-stream viewer with chat + gift action (PRD §10.6 LV-04). */
export default function LiveViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const streamId = id ?? '';
  const stream = useLiveStream(streamId);
  const chat = useLiveChat(streamId);
  const sendChat = useSendLiveChat(streamId);
  const [draft, setDraft] = useState('');
  const [following, setFollowing] = useState(false);

  if (stream.isLoading) {
    return <SafeAreaView style={styles.safe}><StateView kind="loading" message="Joining stream…" /></SafeAreaView>;
  }
  if (stream.isError || !stream.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <StateView kind="error" title="Stream unavailable" message="This stream may have ended." actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }
  const s = stream.data;

  function onSend() {
    const t = draft.trim();
    if (!t) return;
    sendChat.mutate(t);
    setDraft('');
  }

  function renderMsg({ item }: { item: LiveChatMessage }) {
    return (
      <View style={styles.msgRow}>
        <Text style={[styles.msgName, item.isHost && styles.msgHost]}>{item.userName}</Text>
        <Text style={styles.msgText}>{item.text}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.video}>
        {/* video surface placeholder (moderated stream) */}
        <Image source={{ uri: s.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={1} />
        <View style={styles.scrim} />

        {/* Top overlay: host + viewers + close */}
        <View style={styles.topBar}>
          <View style={styles.hostPill}>
            <Image source={{ uri: s.hostAvatar }} style={styles.hostAvatar} />
            <View style={{ maxWidth: 110 }}>
              <Text style={styles.hostName} numberOfLines={1}>{s.hostName}</Text>
              <View style={styles.viewerInline}>
                <Eye size={11} color={Colors.onPrimary} strokeWidth={2.2} />
                <Text style={styles.viewerInlineText}>{s.viewerCount.toLocaleString('en-NG')}</Text>
              </View>
            </View>
            <Pressable
              style={[styles.followBtn, following && styles.followingBtn]}
              accessibilityRole="button"
              accessibilityLabel={following ? 'Following' : 'Follow host'}
              onPress={() => setFollowing((v) => !v)}
            >
              <Text style={[styles.followText, following && styles.followingText]}>{following ? 'Following' : 'Follow'}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.closeBtn} accessibilityLabel="Leave stream" onPress={() => router.back()}>
            <Text style={styles.closeX}>✕</Text>
          </Pressable>
        </View>

        {/* PK entry if applicable */}
        {s.format === 'pk' && (
          <Pressable
            style={styles.pkChip}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/connect/livestream/pk-battle-view', params: { id: s.id } })}
          >
            <Swords size={13} color={Colors.onPrimary} strokeWidth={2.4} />
            <Text style={styles.pkChipText}>PK battle — tap to view scores</Text>
          </Pressable>
        )}

        {/* Bottom: chat + actions */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottomWrap}>
          <FlatList
            data={(chat.data ?? []).slice(-30)}
            keyExtractor={(m) => m.id}
            renderItem={renderMsg}
            style={styles.chatList}
            showsVerticalScrollIndicator={false}
            inverted={false}
          />
          <View style={styles.actionBar}>
            <View style={styles.inputWrap}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Say something…"
                placeholderTextColor={Colors.inverseOnSurface}
                style={styles.input}
                onSubmitEditing={onSend}
                returnKeyType="send"
              />
              <Pressable hitSlop={8} accessibilityLabel="Send message" onPress={onSend}>
                <Send size={18} color={Colors.onPrimary} strokeWidth={2.2} />
              </Pressable>
            </View>
            <Pressable style={styles.iconAction} accessibilityLabel="Like">
              <Heart size={20} color={Colors.onPrimary} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              style={styles.iconAction}
              accessibilityLabel="Request to co-host"
              onPress={() => router.push({ pathname: '/connect/livestream/co-host-request', params: { id: s.id } })}
            >
              <UserPlus size={20} color={Colors.onPrimary} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              style={styles.iconAction}
              accessibilityLabel="Leaderboard"
              onPress={() => router.push('/connect/livestream/leaderboard')}
            >
              <Trophy size={20} color={Colors.onPrimary} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              style={styles.giftBtn}
              accessibilityRole="button"
              accessibilityLabel="Send a gift (real money)"
              onPress={() => router.push({ pathname: '/connect/livestream/gifts-sheet', params: { id: s.id } })}
            >
              <Gift size={20} color={Colors.onPrimary} strokeWidth={2.2} />
              <Text style={styles.giftText}>Gift</Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.reportRow}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/connect/livestream/report-stream', params: { id: s.id } })}
          >
            <Flag size={12} color={Colors.inverseOnSurface} strokeWidth={2} />
            <Text style={styles.reportText}>Report stream</Text>
          </Pressable>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark },
  video: { flex: 1, justifyContent: 'space-between' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,28,48,0.28)' },
  topBar: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: Spacing.md },
  hostPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(11,28,48,0.5)', borderRadius: Radius.full, paddingVertical: 5, paddingLeft: 5, paddingRight: 8 },
  hostAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.surfaceContainer },
  hostName: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  viewerInline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewerInlineText: { ...Typography.labelSm, color: Colors.inverseOnSurface, fontSize: 11 },
  followBtn: { backgroundColor: ConnectColors.brand, paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full },
  followingBtn: { backgroundColor: 'rgba(255,255,255,0.18)' },
  followText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' as const },
  followingText: { color: Colors.onPrimary },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,28,48,0.5)', alignItems: 'center', justifyContent: 'center' },
  closeX: { color: Colors.onPrimary, fontSize: 16, fontWeight: '700' as const },
  pkChip: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ConnectColors.brand, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full },
  pkChipText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' as const },
  bottomWrap: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm },
  chatList: { maxHeight: 200 },
  msgRow: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'rgba(11,28,48,0.4)', alignSelf: 'flex-start', borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 5, gap: 6, maxWidth: '90%' },
  msgName: { ...Typography.labelSm, color: ConnectColors.accent, fontWeight: '700' as const },
  msgHost: { color: Colors.tertiaryFixedDim },
  msgText: { ...Typography.labelSm, color: Colors.onPrimary },
  actionBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(11,28,48,0.5)', borderRadius: Radius.full, paddingHorizontal: 14, height: 42 },
  input: { flex: 1, ...Typography.bodyMd, color: Colors.onPrimary, padding: 0 },
  iconAction: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(11,28,48,0.5)', alignItems: 'center', justifyContent: 'center' },
  giftBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ConnectColors.accent, paddingHorizontal: 14, height: 42, borderRadius: Radius.full },
  giftText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center', paddingVertical: 4 },
  reportText: { ...Typography.labelSm, color: Colors.inverseOnSurface },
});
