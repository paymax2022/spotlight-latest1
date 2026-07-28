import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { KIND_META } from '@/features/announcements/api';
import { useAnnouncement } from '@/features/announcements/hooks';
import { formatDateTime } from '@/features/visitor/utils/visitorFormatters';

export default function AnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useAnnouncement(id ?? '');

  if (a.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Announcement" /><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  if (a.isError || !a.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Announcement" /><StateView kind="error" title="Unavailable" message="Couldn't load this announcement." actionLabel="Retry" onAction={() => a.refetch()} /></SafeAreaView>;

  const item = a.data;
  const meta = KIND_META[item.kind];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Megaphone;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Announcement" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.kindRow]}>
          <View style={[styles.iconBox, { backgroundColor: meta.bg }]}><Icon size={18} color={meta.color} strokeWidth={1.8} /></View>
          <Text style={[styles.kindText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.byline}>{item.createdByName ?? 'Estate'} · {formatDateTime(item.createdAt)}</Text>
        <Text style={styles.body}>{item.body}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  kindText: { ...Typography.labelMd, fontWeight: '700' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  byline: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyLg, color: Colors.onSurface, lineHeight: 28, marginTop: Spacing.sm },
});
