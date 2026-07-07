import React from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Play, Eye, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useReplays } from '@/features/connect/livestream/hooks';
import type { StreamReplay } from '@/features/connect/livestream/types';

/** Past streams / replays — moderated VOD (PRD §10.6 LV-10). */
export default function ReplayScreen() {
  const q = useReplays();

  function fmtDur(sec: number) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function renderItem({ item }: { item: StreamReplay }) {
    return (
      <Pressable style={styles.card} accessibilityRole="button" accessibilityLabel={`Play replay ${item.title}`}>
        <View>
          <Image source={{ uri: item.coverUrl }} style={styles.cover} resizeMode="cover" />
          <View style={styles.playBtn}><Play size={20} color={Colors.onPrimary} strokeWidth={2.4} /></View>
          <View style={styles.durBadge}><Text style={styles.durText}>{fmtDur(item.durationSec)}</Text></View>
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.host}>{item.hostName}</Text>
          <View style={styles.metaRow}>
            <View style={styles.meta}><Eye size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{item.views.toLocaleString('en-NG')}</Text></View>
            <View style={styles.meta}><Gift size={12} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{formatKobo(item.giftRevenueKobo)}</Text></View>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Replays" subtitle="Past streams" />
      {q.isLoading ? (
        <StateView kind="loading" message="Loading replays…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load replays" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Play" title="No replays yet" message="Streams you save will appear here." />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, overflow: 'hidden' },
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: Colors.surfaceContainer },
  playBtn: { position: 'absolute', top: '50%', left: '50%', marginLeft: -22, marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(11,28,48,0.55)', alignItems: 'center', justifyContent: 'center' },
  durBadge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: Colors.backdropDark, paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.sm },
  durText: { ...Typography.labelSm, color: Colors.onPrimary, fontSize: 11 },
  body: { padding: Spacing.md, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  host: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.md, marginTop: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
