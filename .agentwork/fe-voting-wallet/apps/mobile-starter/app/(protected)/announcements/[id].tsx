// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAnnouncement, markAnnouncementRead } from '@/api/announcements.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const categoryColors: Record<string, string> = {
  emergency: colors.secondary.red,
  security: '#f97316',
  payment: colors.secondary.DEFAULT,
  meeting: colors.primary.DEFAULT,
  maintenance: colors.secondary.amber,
  general: colors.neutral.border,
  election: colors.secondary.emerald,
};

export default function AnnouncementDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const { data: announcement, isLoading, isError, refetch } = useQuery({
    queryKey: ['announcement', estateId, id],
    queryFn: () => getAnnouncement(estateId, id),
    staleTime: 30_000,
  });

  const readMut = useMutation({
    mutationFn: () => markAnnouncementRead(estateId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements', estateId] }),
  });

  useEffect(() => {
    if (announcement && !announcement.read) readMut.mutate();
  }, [announcement?.id]);

  const handleShare = () => {
    if (announcement) {
      Share.share({ title: announcement.title, message: `${announcement.title}\n\n${announcement.body}` });
    }
  };

  const catColor = announcement ? (categoryColors[announcement.category] ?? colors.neutral.textMuted) : colors.primary.DEFAULT;

  if (isLoading) return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: catColor }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Announcement</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
    </SafeAreaView>
  );

  if (isError || !announcement) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Announcement</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.centered}>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>Failed to load announcement</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: catColor }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>{announcement.category.charAt(0).toUpperCase() + announcement.category.slice(1)}</Text>
        <Pressable style={styles.backBtn} onPress={handleShare}>
          <Ionicons name="share-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.categoryBanner, { backgroundColor: catColor + '15', borderColor: catColor + '40' }]}>
          <Text style={[styles.categoryLabel, { color: catColor }]}>{announcement.category.toUpperCase()}</Text>
        </View>

        <Text style={styles.announcementTitle}>{announcement.title}</Text>

        <View style={styles.metaRow}>
          <Ionicons name="person-circle-outline" size={18} color={colors.neutral.textMuted} />
          <Text style={styles.metaText}>{announcement.author_name}</Text>
          <Text style={styles.metaDivider}>·</Text>
          <Text style={styles.metaText}>{new Date(announcement.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
        </View>

        <Text style={styles.bodyText}>{announcement.body}</Text>

        {announcement.attachment_url ? (
          <View style={styles.attachmentCard}>
            <Ionicons name="attach-outline" size={20} color={colors.primary.DEFAULT} />
            <View style={{ flex: 1 }}>
              <Text style={styles.attachmentLabel}>Attachment</Text>
              <Text style={styles.attachmentUrl} numberOfLines={1}>{announcement.attachment_url}</Text>
            </View>
            <Pressable style={styles.downloadBtn} onPress={() => Linking.openURL(announcement.attachment_url!)}>
              <Ionicons name="download-outline" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  categoryBanner: { borderRadius: 12, padding: 10, borderWidth: 1, alignItems: 'center' },
  categoryLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  announcementTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, lineHeight: 30 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: colors.neutral.textMuted },
  metaDivider: { color: colors.neutral.border, fontSize: 16 },
  bodyText: { fontSize: 15, color: colors.neutral.text, lineHeight: 26 },
  attachmentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  attachmentLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  attachmentUrl: { fontSize: 13, color: colors.primary.DEFAULT },
  downloadBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10, margin: 20 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});
