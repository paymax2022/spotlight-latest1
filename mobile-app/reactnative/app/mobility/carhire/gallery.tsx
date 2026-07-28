import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView, FlatList, useWindowDimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { X, Play } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { VEHICLE_CLASSES } from '@/features/mobility/constants/modes.constants';
import { VEHICLE_CLASS_META, VEHICLE_CLASS_GALLERY, type GalleryMedia } from '@/features/mobility/constants/carhireCatalog';
import type { VehicleClass } from '@/features/mobility/types/modes.types';

/** Cross-platform inline video: HTML5 <video> on web, Leaflet-style WebView on
 *  native. Real uploaded walkaround videos plug straight in. */
function GalleryVideo({ url, poster, width, height }: { url: string; poster?: string; width: number; height: number }) {
  if (Platform.OS === 'web') {
    return React.createElement('video', {
      src: url,
      poster,
      controls: true,
      playsInline: true,
      preload: 'metadata',
      style: { width, height, objectFit: 'cover', borderRadius: 16, background: '#000' },
    });
  }
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/><style>html,body{margin:0;background:#000;height:100%}video{width:100%;height:100%;object-fit:contain}</style></head><body><video src="${url}" poster="${poster ?? ''}" controls playsinline webkit-playsinline></video></body></html>`;
  return (
    <View style={{ width, height, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
      <WebView source={{ html }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} style={{ flex: 1, backgroundColor: '#000' }} />
    </View>
  );
}

export default function CarHireGalleryScreen() {
  const { class: classParam } = useLocalSearchParams<{ class?: string }>();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<GalleryMedia>>(null);
  const [active, setActive] = useState(0);

  const vehicleClass = (VEHICLE_CLASSES.find((v) => v.value === classParam)?.value ?? 'executive') as VehicleClass;
  const meta = VEHICLE_CLASS_META[vehicleClass];
  const media = VEHICLE_CLASS_GALLERY[vehicleClass];
  const label = VEHICLE_CLASSES.find((v) => v.value === vehicleClass)?.label ?? 'Vehicle';

  const heroW = width;
  const heroH = Math.round(Math.min(width, 520) * 0.72);
  const photoCount = useMemo(() => media.filter((m) => m.type === 'image').length, [media]);
  const videoCount = media.length - photoCount;

  const goTo = (i: number) => {
    setActive(i);
    listRef.current?.scrollToIndex({ index: i, animated: true });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close gallery">
          <X size={22} color={Colors.white} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{label}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{meta.model} · {photoCount} photos · {videoCount} video</Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={media}
        keyExtractor={(m, i) => `${m.type}-${i}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: heroW, offset: heroW * i, index: i })}
        onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / heroW))}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: heroW }]}>
            {item.type === 'video' ? (
              <GalleryVideo url={item.url} poster={item.poster} width={heroW - Spacing.containerMargin * 2} height={heroH} />
            ) : (
              <Image source={{ uri: item.url }} style={[styles.photo, { width: heroW - Spacing.containerMargin * 2, height: heroH }]} resizeMode="cover" />
            )}
            {item.label ? (
              <View style={styles.slideBadge}><Text style={styles.slideBadgeText}>{item.label}</Text></View>
            ) : null}
          </View>
        )}
      />

      <View style={styles.counter}><Text style={styles.counterText}>{active + 1} / {media.length}</Text></View>

      {/* Thumbnail strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbs} contentContainerStyle={styles.thumbsContent}>
        {media.map((m, i) => (
          <Pressable key={`t-${i}`} onPress={() => goTo(i)} style={[styles.thumbWrap, i === active && styles.thumbActive]}>
            <Image source={{ uri: m.type === 'video' ? (m.poster ?? m.url) : m.url }} style={styles.thumb} resizeMode="cover" />
            {m.type === 'video' ? (
              <View style={styles.thumbPlay}><Play size={14} color={Colors.white} fill={Colors.white} strokeWidth={0} /></View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.cta} onPress={() => router.back()} accessibilityLabel={`Choose the ${label}`}>
          <Text style={styles.ctaText}>Back to booking</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark ?? '#0B1220' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.titleMd, color: Colors.white, fontWeight: '700' as const },
  headerSub: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)' },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.containerMargin },
  photo: { borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh },
  slideBadge: { position: 'absolute', bottom: Spacing.md, left: Spacing.containerMargin + Spacing.sm, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.full, paddingVertical: 4, paddingHorizontal: 10 },
  slideBadgeText: { ...Typography.labelSm, color: Colors.white, fontWeight: '600' as const },
  counter: { alignItems: 'center', paddingVertical: Spacing.sm },
  counterText: { ...Typography.labelSm, color: 'rgba(255,255,255,0.8)' },
  thumbs: { maxHeight: 84 },
  thumbsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, alignItems: 'center' },
  thumbWrap: { width: 76, height: 60, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: Colors.surfaceContainerHigh },
  thumbActive: { borderColor: Colors.white },
  thumb: { width: '100%', height: '100%' },
  thumbPlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md },
  cta: { height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white },
  ctaText: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
});
