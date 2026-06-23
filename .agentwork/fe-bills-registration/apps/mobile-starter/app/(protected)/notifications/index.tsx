// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';
import { useState } from 'react';

interface Notification { id: string; title: string; body: string; type: string; read: boolean; created_at: string; action_url?: string; }

const CATEGORIES = ['All', 'Visitor', 'Payment', 'Security', 'Meeting', 'Tasks'];

const CATEGORY_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  visitor: { icon: 'person-outline', color: '#8B5CF6', bg: '#f5f3ff' },
  payment: { icon: 'cash-outline', color: colors.secondary.emerald, bg: '#f0fdf4' },
  security: { icon: 'shield-outline', color: colors.secondary.red, bg: '#fef2f2' },
  meeting: { icon: 'people-outline', color: colors.secondary.DEFAULT, bg: '#eff6ff' },
  tasks: { icon: 'checkmark-circle-outline', color: colors.secondary.amber, bg: '#fffbeb' },
  default: { icon: 'notifications-outline', color: colors.primary.DEFAULT, bg: colors.neutral.surfaceAlt },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function groupNotifications(items: Notification[]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups: Record<string, Notification[]> = { Today: [], Yesterday: [], Older: [] };
  items.forEach((n) => {
    const d = new Date(n.created_at).toDateString();
    if (d === today) groups.Today.push(n);
    else if (d === yesterday) groups.Yesterday.push(n);
    else groups.Older.push(n);
  });
  return Object.entries(groups).filter(([, v]) => v.length > 0);
}

export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState('All');

  const { data: notifications = [], isLoading, refetch } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      const res = await fetch(`/api/estate/${ctx.estateId}/notifications`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      await fetch(`/api/estate/${ctx.estateId}/notifications/mark-all-read`, { method: 'POST' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const handleTap = async (n: Notification) => {
    queryClient.setQueryData<Notification[]>(['notifications'], (old) =>
      (old ?? []).map((item) => item.id === n.id ? { ...item, read: true } : item)
    );
    if (n.action_url) router.push(n.action_url as never);
    else router.push({ pathname: '/notifications/[id]', params: { id: n.id } } as never);
  };

  const filtered = activeCategory === 'All'
    ? notifications
    : notifications.filter((n) => n.type.toLowerCase() === activeCategory.toLowerCase());

  const grouped = groupNotifications(filtered);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}</Text>
        <Pressable style={styles.markAllBtn} onPress={() => markAllRead.mutate()}>
          <Text style={styles.markAllText}>Mark all read</Text>
        </Pressable>
      </View>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat}
            style={[styles.filterChip, activeCategory === cat && styles.filterChipActive]}
            onPress={() => setActiveCategory(cat)}
          >
            <Text style={[styles.filterChipText, activeCategory === cat && styles.filterChipTextActive]}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="notifications-off-outline" size={48} color={colors.neutral.placeholder} />
          <Text style={styles.emptyText}>No notifications</Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={([date]) => date}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
          renderItem={({ item: [date, items] }) => (
            <View style={{ gap: 8 }}>
              <Text style={styles.groupLabel}>{date}</Text>
              <View style={styles.card}>
                {items.map((n, i) => {
                  const cfg = CATEGORY_ICONS[n.type.toLowerCase()] ?? CATEGORY_ICONS.default;
                  return (
                    <Pressable
                      key={n.id}
                      style={[styles.notifRow, i < items.length - 1 && styles.listBorder, !n.read && styles.notifUnread]}
                      onPress={() => handleTap(n)}
                    >
                      <View style={[styles.iconCircle, { backgroundColor: cfg.bg }]}>
                        <Ionicons name={cfg.icon as any} size={18} color={cfg.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.notifTitle, !n.read && { fontWeight: '700' }]}>{n.title}</Text>
                        <Text style={styles.notifBody} numberOfLines={2}>{n.body}</Text>
                        <Text style={styles.notifTime}>{timeAgo(n.created_at)}</Text>
                      </View>
                      {!n.read && <View style={styles.unreadDot} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  markAllBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  markAllText: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  filterScroll: { maxHeight: 52, backgroundColor: colors.neutral.surface, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  filterContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.neutral.surfaceAlt },
  filterChipActive: { backgroundColor: colors.primary.DEFAULT },
  filterChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  filterChipTextActive: { color: '#fff' },
  list: { padding: 16, gap: 12 },
  groupLabel: { fontSize: 11, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  notifRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 12 },
  notifUnread: { backgroundColor: colors.neutral.surfaceAlt },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notifTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  notifBody: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2, lineHeight: 18 },
  notifTime: { fontSize: 11, color: colors.neutral.placeholder, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.secondary.DEFAULT, marginTop: 6, flexShrink: 0 },
  emptyCard: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
