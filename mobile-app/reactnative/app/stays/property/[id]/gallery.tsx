import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView, FlatList, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useProperty } from '@/features/stays/hooks';

export default function GalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prop = useProperty(String(id));
  const { width } = useWindowDimensions();
  const [cat, setCat] = useState(0);

  if (prop.isLoading) return <SafeAreaView style={styles.safe}><StateView kind="loading" message="Loading photos…" /></SafeAreaView>;
  if (prop.isError || !prop.data) return <SafeAreaView style={styles.safe}><StateView kind="error" title="Couldn't load gallery" onAction={() => router.back()} actionLabel="Back" /></SafeAreaView>;

  const p = prop.data;
  const cats = p.mediaCategories;
  const photos = cats[cat]?.urls ?? p.media;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}><X size={22} color={Colors.white} /></Pressable>
        <Text style={styles.headerTitle}>{p.name}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
        {cats.map((c, i) => (
          <Pressable key={c.label} style={[styles.tab, i === cat && styles.tabOn]} onPress={() => setCat(i)}>
            <Text style={[styles.tabText, i === cat && styles.tabTextOn]}>{c.label} ({c.urls.length})</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={photos}
        keyExtractor={(u, i) => `${u}-${i}`}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Image source={{ uri: item }} style={[styles.photo, { width: width - Spacing.containerMargin * 2 }]} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.titleMd, color: Colors.white, flex: 1 },
  tabs: { maxHeight: 48 },
  tabsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, alignItems: 'center' },
  tab: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.12)' },
  tabOn: { backgroundColor: Colors.white },
  tabText: { ...Typography.labelSm, color: Colors.white, fontWeight: '600' as const },
  tabTextOn: { color: Colors.onSurface },
  list: { padding: Spacing.containerMargin },
  photo: { height: 280, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh },
});
