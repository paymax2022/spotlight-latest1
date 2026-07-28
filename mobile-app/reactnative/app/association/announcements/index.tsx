import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Megaphone, ChevronRight, AlertTriangle, CheckCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAnnouncements } from '@/features/association/hooks/useEngagement';
import { relativeTime } from '@/features/association/utils/associationFormatters';

export default function AnnouncementsFeed() {
  const feed = useAnnouncements();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Announcements" />
      {feed.isLoading ? (
        <StateView kind="loading" message="Loading announcements…" />
      ) : feed.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => feed.refetch()} />
      ) : (feed.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Megaphone" title="No announcements" message="New announcements will appear here." />
      ) : (
        <FlatList
          data={feed.data ?? []}
          keyExtractor={(a) => a.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/association/announcements/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.urgent ? ', urgent' : ''}`}
              style={({ pressed }) => [styles.card, shadow1, !item.read && styles.cardUnread, pressed && styles.pressed]}
            >
              <View style={[styles.iconBox, item.urgent && styles.iconBoxUrgent]}>
                {item.urgent
                  ? <AlertTriangle size={18} color={Colors.error} strokeWidth={2} />
                  : <Megaphone size={18} color={Colors.primary} strokeWidth={2} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  {!item.read ? <View style={styles.dot} /> : null}
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                </View>
                <Text style={styles.preview} numberOfLines={2}>{item.preview}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>{item.audience} · {relativeTime(item.postedAt)}</Text>
                  {item.requiresAck ? (
                    <View style={[styles.ackChip, item.acknowledged && styles.ackChipDone]}>
                      {item.acknowledged ? <CheckCheck size={11} color={Colors.teal} strokeWidth={2.4} /> : null}
                      <Text style={[styles.ackText, item.acknowledged && styles.ackTextDone]}>
                        {item.acknowledged ? 'Acknowledged' : 'Action needed'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  cardUnread: { borderColor: Colors.primaryFixedDim },
  pressed: { opacity: 0.85 },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  iconBoxUrgent: { backgroundColor: Colors.errorContainer },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: Colors.secondary },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginTop: Spacing.sm },
  meta: { ...Typography.caption, color: Colors.outline, flexShrink: 1 },
  ackChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  ackChipDone: { backgroundColor: Colors.iconBgTeal },
  ackText: { ...Typography.caption, color: Colors.gold, fontWeight: '700' as const },
  ackTextDone: { color: Colors.teal },
});
