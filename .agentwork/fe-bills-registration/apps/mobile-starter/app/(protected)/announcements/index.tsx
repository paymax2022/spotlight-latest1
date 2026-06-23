// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listAnnouncements } from '@/api/announcements.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const CATEGORIES = ['All', 'Security', 'Payment', 'Maintenance', 'Meeting', 'Emergency'] as const;

const categoryColors: Record<string, string> = {
  emergency: colors.secondary.red,
  security: '#f97316',
  payment: colors.secondary.DEFAULT,
  meeting: colors.primary.DEFAULT,
  maintenance: colors.secondary.amber,
  general: colors.neutral.border,
  election: colors.secondary.emerald,
};

const priorityDot: Record<string, string> = {
  urgent: colors.secondary.red,
  high: colors.secondary.amber,
  medium: colors.secondary.DEFAULT,
  low: colors.neutral.textMuted,
};

export default function AnnouncementsIndex() {
  const router = useRouter();
  const { estateId } = getActiveEstateContext();
  const [activeCategory, setActiveCategory] = useState('All');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['announcements', estateId],
    queryFn: () => listAnnouncements(estateId),
    staleTime: 30_000,
  });

  const filtered = activeCategory === 'All'
    ? (data ?? [])
    : (data ?? []).filter(a => a.category.toLowerCase() === activeCategory.toLowerCase());

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Announcements</Text>
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
        ListHeaderComponent={
          <FlatList
            data={CATEGORIES as unknown as string[]}
            keyExtractor={(item) => item}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterList}
            contentContainerStyle={styles.filterContent}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.filterChip, activeCategory === item && styles.filterChipActive]}
                onPress={() => setActiveCategory(item)}
              >
                <Text style={[styles.filterChipText, activeCategory === item && styles.filterChipTextActive]}>{item}</Text>
              </Pressable>
            )}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
          ) : isError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>Failed to load announcements</Text>
              <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="megaphone-outline" size={40} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No announcements yet</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const cat = item.category.toLowerCase();
          const borderColor = categoryColors[cat] ?? colors.neutral.border;
          return (
            <Pressable style={[styles.announcementCard, { borderLeftColor: borderColor }]} onPress={() => router.push(`/announcements/${item.id}` as never)}>
              <View style={styles.cardHeader}>
                <View style={[styles.catBadge, { backgroundColor: borderColor + '22' }]}>
                  <Text style={[styles.catBadgeText, { color: borderColor }]}>{item.category}</Text>
                </View>
                <View style={styles.rightMeta}>
                  {!item.read ? <View style={[styles.unreadDot, { backgroundColor: borderColor }]} /> : null}
                  <View style={[styles.dotBadge, { backgroundColor: priorityDot[item.priority] ?? colors.neutral.textMuted }]} />
                </View>
              </View>
              <Text style={styles.announcementTitle}>{item.title}</Text>
              <Text style={styles.announcementBody} numberOfLines={2}>{item.body}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.authorText}>{item.author_name}</Text>
                <Text style={styles.timestampText}>{new Date(item.created_at).toLocaleDateString()}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  filterList: { marginBottom: 4 },
  filterContent: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface, marginRight: 8 },
  filterChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  filterChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  filterChipTextActive: { color: '#fff' },
  listContent: { padding: 16, gap: 12, paddingBottom: 40 },
  announcementCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  catBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  rightMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  dotBadge: { width: 8, height: 8, borderRadius: 4 },
  announcementTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  announcementBody: { fontSize: 13, color: colors.neutral.textMuted, lineHeight: 20 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  authorText: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  timestampText: { fontSize: 12, color: colors.neutral.placeholder },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10, margin: 10 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});
