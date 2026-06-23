// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function DocumentArchiveScreen() {
  const router = useRouter();
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['docs-archive', estateId],
    queryFn: async () => {
      if (!estateId) return [];
      const res = await fetch(`/api/estates/${estateId}/documents?archive=true`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!estateId,
  });

  // Group by year
  const grouped = (data ?? []).reduce((acc, doc) => {
    const year = doc.uploaded_at ? new Date(doc.uploaded_at).getFullYear().toString() : 'Unknown';
    if (!acc[year]) acc[year] = [];
    acc[year].push(doc);
    return acc;
  }, {});

  const sections = Object.keys(grouped).sort((a, b) => Number(b) - Number(a)).map((year) => ({ title: year, data: grouped[year] }));

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Archive</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load archive</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : sections.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="archive-outline" size={48} color={colors.neutral.placeholder} />
          <Text style={s.emptyTxt}>No archived documents</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderSectionHeader={({ section: { title } }) => (
            <View style={s.sectionHeader}><Text style={s.sectionHeaderTxt}>{title}</Text></View>
          )}
          renderItem={({ item, index, section }) => {
            const isLast = index === section.data.length - 1;
            return (
              <View style={[s.row, !isLast && s.rowBorder]}>
                <View style={s.fileIcon}><Ionicons name="document-text" size={20} color={colors.primary.DEFAULT} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.sub}>{item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString('en-NG') : '—'}</Text>
                </View>
                <Pressable style={s.dlBtn} onPress={() => item.url && Linking.openURL(item.url)}>
                  <Ionicons name="download-outline" size={16} color="#fff" />
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  sectionHeader: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.neutral.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  sectionHeaderTxt: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.neutral.surface },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  fileIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  dlBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
