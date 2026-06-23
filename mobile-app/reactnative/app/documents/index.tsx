import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Plus, Lock, ExternalLink } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useDocuments } from '@/features/documents/hooks';
import { CATEGORY_META } from '@/features/documents/api';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import type { EstateDocument, DocumentCategory } from '@/features/documents/api';

export default function DocumentsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useDocuments();
  const [filter, setFilter] = useState<DocumentCategory | 'all'>('all');

  const cats = useMemo(() => {
    const set = new Set<string>((data ?? []).map((d) => d.category));
    return ['all', ...Array.from(set)] as (DocumentCategory | 'all')[];
  }, [data]);
  const filtered = useMemo(() => (data ?? []).filter((d) => filter === 'all' || d.category === filter), [data, filter]);

  const open = (d: EstateDocument) => { Linking.openURL(d.fileUrl).catch(() => {}); };

  const renderItem = ({ item }: { item: EstateDocument }) => {
    const meta = CATEGORY_META[item.category as DocumentCategory] ?? CATEGORY_META.general;
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.File;
    return (
      <Pressable onPress={() => open(item)} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.iconBox}><Icon size={20} color={Colors.secondary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{meta.label} · {relativeTime(item.createdAt)}</Text>
            {item.restricted ? <View style={styles.lockRow}><Lock size={11} color={Colors.error} strokeWidth={2} /><Text style={styles.lockText}>Restricted</Text></View> : null}
          </View>
        </View>
        <ExternalLink size={18} color={Colors.outline} strokeWidth={1.8} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Documents" rightSlot={
        <Pressable onPress={() => router.push('/documents/upload')} accessibilityRole="button" accessibilityLabel="Add document" hitSlop={8} style={styles.addBtn}><Plus size={22} color={Colors.secondary} strokeWidth={2.2} /></Pressable>
      } />
      {(data ?? []).length > 0 ? (
        <FlatList horizontal data={cats} keyExtractor={(c) => c} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={styles.filterList}
          renderItem={({ item: c }) => {
            const selected = c === filter; const label = c === 'all' ? 'All' : (CATEGORY_META[c as DocumentCategory]?.label ?? c);
            return (
              <Pressable onPress={() => setFilter(c)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.filterChip, selected && styles.filterChipSel]}>
                <Text style={[styles.filterText, selected && styles.filterTextSel]}>{label}</Text>
              </Pressable>
            );
          }} />
      ) : null}
      {isLoading ? <StateView kind="loading" message="Loading documents…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={filtered} keyExtractor={(d) => d.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="FolderOpen" title="No documents" message="Estate documents and notices will appear here." />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  filterList: { maxHeight: 44, marginBottom: Spacing.sm },
  filterRow: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, alignItems: 'center' },
  filterChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, height: 34, justifyContent: 'center' },
  filterChipSel: { backgroundColor: Colors.primary },
  filterText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  filterTextSel: { color: Colors.onPrimary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  pressed: { opacity: 0.85 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lockText: { ...Typography.labelSm, color: Colors.error, fontWeight: '700' },
});
