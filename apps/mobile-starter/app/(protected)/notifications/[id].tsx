// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

interface Notification { id: string; title: string; body: string; type: string; read: boolean; created_at: string; action_url?: string; }

const CATEGORY_CONFIG: Record<string, { color: string; bg: string; bannerBg: string }> = {
  payment: { color: colors.secondary.emerald, bg: '#f0fdf4', bannerBg: '#dcfce7' },
  visitor: { color: '#8B5CF6', bg: '#f5f3ff', bannerBg: '#ede9fe' },
  security: { color: colors.secondary.red, bg: '#fef2f2', bannerBg: '#fee2e2' },
  meeting: { color: colors.secondary.DEFAULT, bg: '#eff6ff', bannerBg: '#dbeafe' },
  tasks: { color: colors.secondary.amber, bg: '#fffbeb', bannerBg: '#fef3c7' },
  default: { color: colors.primary.DEFAULT, bg: colors.neutral.surfaceAlt, bannerBg: '#e0d4f5' },
};

export default function NotificationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: notification, isLoading } = useQuery<Notification>({
    queryKey: ['notification', id],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      const res = await fetch(`/api/estate/${ctx.estateId}/notifications/${id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const cfg = notification ? (CATEGORY_CONFIG[notification.type.toLowerCase()] ?? CATEGORY_CONFIG.default) : CATEGORY_CONFIG.default;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Notification</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
      ) : !notification ? (
        <View style={styles.emptyCard}><Text style={styles.emptyText}>Notification not found</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.categoryBanner, { backgroundColor: cfg.bannerBg }]}>
            <Text style={[styles.categoryText, { color: cfg.color }]}>{notification.type.toUpperCase()}</Text>
          </View>

          <Text style={styles.title}>{notification.title}</Text>
          <Text style={styles.timestamp}>{new Date(notification.created_at).toLocaleString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>

          <View style={styles.bodyCard}>
            <Text style={styles.bodyText}>{notification.body}</Text>
          </View>

          {notification.action_url && (
            <Pressable style={styles.actionBtn} onPress={() => router.push(notification.action_url as never)}>
              <Text style={styles.actionBtnText}>Related Action</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primary.DEFAULT} />
            </Pressable>
          )}

          <Pressable style={styles.deleteBtn} onPress={() => {
            Alert.alert('Delete', 'Delete this notification?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => router.back() },
            ]);
          }}>
            <Ionicons name="trash-outline" size={18} color={colors.secondary.red} />
            <Text style={styles.deleteBtnText}>Delete Notification</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  categoryBanner: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  categoryText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, lineHeight: 30 },
  timestamp: { fontSize: 13, color: colors.neutral.textMuted },
  bodyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  bodyText: { fontSize: 15, color: colors.neutral.text, lineHeight: 24 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  actionBtnText: { fontSize: 15, fontWeight: '700', color: colors.primary.DEFAULT },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  deleteBtnText: { fontSize: 14, fontWeight: '600', color: colors.secondary.red },
  emptyCard: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
