import React from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mic, MicOff, Ban, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useLiveViewers, useModerateViewer } from '@/features/connect/live/hooks';
import type { LiveViewer } from '@/features/connect/live/types';

/** Host moderation — mute/kick/ban viewers (PRD §10.7 LB-06). */
export default function ModerationScreen() {
  const q = useLiveViewers();
  const mod = useModerateViewer();

  function renderItem({ item }: { item: LiveViewer }) {
    return (
      <View style={styles.row}>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          {item.isCoHost ? <Text style={styles.cohost}>Co-host</Text> : item.isMuted ? <Text style={styles.muted}>Muted</Text> : null}
        </View>
        <Pressable
          style={styles.iconBtn}
          accessibilityLabel={item.isMuted ? `Unmute ${item.name}` : `Mute ${item.name}`}
          onPress={() => mod.mutate({ viewerId: item.id, action: item.isMuted ? 'unmute' : 'mute' })}
        >
          {item.isMuted ? <MicOff size={18} color={Colors.error} strokeWidth={2.2} /> : <Mic size={18} color={Colors.onSurfaceVariant} strokeWidth={2.2} />}
        </Pressable>
        <Pressable
          style={styles.banBtn}
          accessibilityLabel={`Remove ${item.name}`}
          onPress={() => mod.mutate({ viewerId: item.id, action: 'kick' })}
        >
          <Ban size={16} color={Colors.error} strokeWidth={2.2} />
          <Text style={styles.banText}>Remove</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Moderation" subtitle="Manage who's in your stream" />
      {q.isLoading ? (
        <StateView kind="loading" message="Loading viewers…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load viewers" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Users" title="No viewers yet" message="People who join will appear here." />
      ) : (
        <>
          <View style={styles.banner}>
            <Users size={15} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.bannerText}>Muting hides a viewer's chat. Removing kicks them from this stream. Repeat abuse is escalated to platform moderators.</Text>
          </View>
          <FlatList data={q.data ?? []} keyExtractor={(v) => v.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  banner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  bannerText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 17 },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceContainer },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  cohost: { ...Typography.labelSm, color: ConnectColors.brand },
  muted: { ...Typography.labelSm, color: Colors.error },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  banBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.errorContainer, backgroundColor: Colors.errorContainer },
  banText: { ...Typography.labelMd, color: Colors.error, fontWeight: '700' as const },
});
