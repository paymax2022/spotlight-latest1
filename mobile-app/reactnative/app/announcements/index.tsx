import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Plus, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { KIND_META } from '@/features/announcements/api';
import { useAnnouncements } from '@/features/announcements/hooks';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { Announcement } from '@/features/announcements/api';

export default function AnnouncementsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useAnnouncements();

  const renderItem = ({ item }: { item: Announcement }) => {
    const meta = KIND_META[item.kind];
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Megaphone;
    return (
      <Pressable onPress={() => router.push(`/announcements/${item.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.card, !item.read && styles.unread, pressed && styles.pressed]}>
        <View style={[styles.iconBox, { backgroundColor: meta.bg }]}><Icon size={20} color={meta.color} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
            {!item.read ? <View style={styles.dot} /> : null}
          </View>
          <Text style={styles.preview} numberOfLines={2}>{item.body}</Text>
          <Text style={styles.meta}>{meta.label} · {relativeTime(item.createdAt)}</Text>
        </View>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Announcements" rightSlot={
        <Pressable onPress={() => router.push('/announcements/create')} accessibilityRole="button" accessibilityLabel="Post announcement" hitSlop={8} style={styles.addBtn}><Plus size={22} color={Colors.secondary} strokeWidth={2.2} /></Pressable>
      } />
      {isLoading ? <StateView kind="loading" message="Loading announcements…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={data ?? []} keyExtractor={(a) => a.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="Megaphone" title="No announcements" message="Estate notices will appear here." />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  unread: { backgroundColor: Colors.surfaceContainerLow },
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.secondary },
  preview: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.labelSm, color: Colors.outline },
});
