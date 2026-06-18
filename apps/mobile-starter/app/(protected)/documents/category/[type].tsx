// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';
import { useState } from 'react';

function fileIcon(ext) {
  if (['pdf'].includes(ext)) return 'document';
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return 'image';
  return 'document-text';
}

export default function DocumentCategoryScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams();
  const [search, setSearch] = useState('');
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['documents', estateId, type],
    queryFn: async () => {
      if (!estateId) return [];
      const res = await fetch(`/api/estates/${estateId}/documents?type=${type}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!estateId && !!type,
  });

  const docs = (data ?? []).filter((d) => !search || d.name?.toLowerCase().includes(search.toLowerCase()));
  const label = String(type).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const renderItem = ({ item, index }) => {
    const ext = item.name?.split('.').pop()?.toLowerCase() ?? '';
    const icon = fileIcon(ext);
    const isLast = index === docs.length - 1;
    return (
      <View style={[s.row, !isLast && s.rowBorder]}>
        <View style={s.fileIcon}><Ionicons name={icon} size={22} color={colors.primary.DEFAULT} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{item.name}</Text>
          <Text style={s.sub}>{item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString('en-NG') : '—'} · {item.uploaded_by ?? '—'}</Text>
        </View>
        <Pressable style={s.dlBtn} onPress={() => item.url && Linking.openURL(item.url)}>
          <Ionicons name="download-outline" size={18} color="#fff" />
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle} numberOfLines={1}>{label}</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={s.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.neutral.placeholder} />
        <TextInput style={s.searchInput} placeholder="Search documents..." placeholderTextColor={colors.neutral.placeholder} value={search} onChangeText={setSearch} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load documents</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          contentContainerStyle={docs.length === 0 ? { flex: 1 } : { paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="folder-open-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={s.emptyTxt}>No documents found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, backgroundColor: colors.neutral.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.neutral.border },
  searchInput: { flex: 1, fontSize: 15, color: colors.neutral.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.neutral.surface },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  fileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  dlBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
