import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FileText, FileImage, Lock, ChevronRight, AlertCircle, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { useDocuments } from '@/features/association/hooks/useEngagement';
import { formatDate } from '@/features/association/utils/associationFormatters';
import { DOC_SEGMENTS, DOC_CATEGORY_LABEL } from '@/features/association/constants/engagement.constants';
import type { DocumentSummary } from '@/features/association/types/engagement.types';

export default function DocumentsVault() {
  const access = useAdminAccess();
  const isAdmin = Boolean(access.data?.isAdmin);
  const docs = useDocuments();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('all');

  const list = useMemo(() => {
    let l = docs.data ?? [];
    if (cat !== 'all') l = l.filter((d) => d.category === cat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      l = l.filter((d) => d.title.toLowerCase().includes(q));
    }
    return l;
  }, [docs.data, cat, search]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Document vault" />
      <View style={styles.searchWrap}>
        <SearchBar placeholder="Search documents…" value={search} onChangeText={setSearch} />
      </View>
      <View style={styles.segWrap}>
        <SegmentedControl options={DOC_SEGMENTS as never} value={cat} onChange={setCat} scrollable />
      </View>

      {docs.isLoading ? (
        <StateView kind="loading" message="Loading documents…" />
      ) : docs.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => docs.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="FolderOpen" title="No documents" message={search ? `Nothing matches “${search}”.` : 'Documents will appear here.'} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(d) => d.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          renderItem={({ item }) => <DocRow doc={item} />}
        />
      )}
      {isAdmin ? (
        <Pressable
          style={styles.fab}
          onPress={() => router.push('/association/documents/new')}
          accessibilityRole="button"
          accessibilityLabel="Upload document"
        >
          <Plus size={22} color={Colors.onPrimary} strokeWidth={2.6} />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

function DocRow({ doc: d }: { doc: DocumentSummary }) {
  const Icon = d.kind === 'image' ? FileImage : FileText;
  return (
    <Pressable
      onPress={() => router.push(`/association/documents/${d.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${d.title}${d.restricted ? ', restricted' : ''}`}
      style={({ pressed }) => [styles.row, shadow1, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, d.restricted && styles.iconBoxLocked]}>
        {d.restricted ? <Lock size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /> : <Icon size={18} color={Colors.secondary} strokeWidth={2} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{d.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {DOC_CATEGORY_LABEL[d.category]} · {d.sizeLabel} · {formatDate(d.updatedAt)}
        </Text>
        {d.requiresAck && !d.acknowledged ? (
          <View style={styles.ackRow}>
            <AlertCircle size={11} color={Colors.gold} strokeWidth={2.4} />
            <Text style={styles.ackText}>Acknowledgement required</Text>
          </View>
        ) : null}
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', right: Spacing.containerMargin, bottom: Spacing.xl,
    width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  segWrap: { paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  iconBoxLocked: { backgroundColor: Colors.surfaceContainerHigh },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  ackText: { ...Typography.caption, color: Colors.gold, fontWeight: '700' as const },
});
