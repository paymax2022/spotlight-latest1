// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function DocumentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const { data: doc, isLoading, isError, refetch } = useQuery({
    queryKey: ['document', id],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const handleShare = async () => {
    try {
      await Share.share({ message: `${doc?.name}: ${doc?.url}` });
    } catch {}
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Document</Text>
        <Pressable style={s.hBtn} onPress={handleShare}><Ionicons name="share-outline" size={20} color="#fff" /></Pressable>
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load document</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.previewBox}>
            <Ionicons name="document-text" size={60} color={colors.neutral.placeholder} />
            <Text style={s.previewTxt}>{doc?.name}</Text>
          </View>

          <View style={s.card}>
            <View style={[s.infoRow, s.rowBorder]}>
              <Text style={s.infoLabel}>Type</Text>
              <Text style={s.infoVal}>{doc?.type?.replace(/_/g, ' ') ?? '—'}</Text>
            </View>
            <View style={[s.infoRow, s.rowBorder]}>
              <Text style={s.infoLabel}>Upload Date</Text>
              <Text style={s.infoVal}>{doc?.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString('en-NG') : '—'}</Text>
            </View>
            <View style={[s.infoRow, s.rowBorder]}>
              <Text style={s.infoLabel}>Uploaded By</Text>
              <Text style={s.infoVal}>{doc?.uploaded_by ?? '—'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Access</Text>
              {doc?.access_restricted ? (
                <View style={s.restrictedBadge}><Text style={s.restrictedBadgeTxt}>Restricted</Text></View>
              ) : (
                <Text style={s.infoVal}>Public</Text>
              )}
            </View>
          </View>

          <Pressable style={s.dlBtn} onPress={() => doc?.url && Linking.openURL(doc.url)}>
            <Ionicons name="download-outline" size={20} color="#fff" />
            <Text style={s.dlBtnTxt}>Download Document</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  previewBox: { backgroundColor: colors.neutral.surface, borderRadius: 16, height: 200, alignItems: 'center', justifyContent: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  previewTxt: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted, textAlign: 'center', paddingHorizontal: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  infoLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  infoVal: { fontSize: 13, fontWeight: '500', color: colors.neutral.text },
  restrictedBadge: { backgroundColor: '#fee2e2', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  restrictedBadgeTxt: { fontSize: 11, color: '#dc2626', fontWeight: '700' },
  dlBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dlBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
