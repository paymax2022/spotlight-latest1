import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, Platform, Linking } from 'react-native';
import { Play, Clapperboard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { PlayAlongVideo } from '../constants';

/**
 * Round lesson-video card. The source (title / url / poster) comes from the
 * competition config and is ADMIN-EDITABLE — swap it without touching this code.
 * On web we render a real inline <video>; on native we show the poster with a
 * play overlay that opens the clip (a lightweight, dependency-free "mock" until
 * an inline native player, e.g. expo-video, is wired).
 */
export default function RoundVideoCard({ video }: { video: PlayAlongVideo }) {
  return (
    <View style={styles.card}>
      <View style={styles.frame}>
        {Platform.OS === 'web'
          ? // react-native-web renders lowercase host tags as real DOM nodes.
            React.createElement('video', {
              src: video.url,
              poster: video.posterUrl,
              controls: true,
              preload: 'none',
              style: { width: '100%', height: 200, backgroundColor: '#000', display: 'block' },
            } as unknown as Record<string, unknown>)
          : (
            <Pressable style={styles.nativeFrame} onPress={() => Linking.openURL(video.url).catch(() => {})}>
              <Image source={{ uri: video.posterUrl }} style={styles.poster} resizeMode="cover" />
              <View style={styles.playOverlay}><Play size={26} color="#fff" fill="#fff" /></View>
            </Pressable>
          )}
      </View>
      <View style={styles.meta}>
        <Clapperboard size={16} color={Colors.primary} strokeWidth={2} />
        <Text style={styles.title} numberOfLines={2}>{video.title}</Text>
        <Text style={styles.badge}>{video.durationLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant },
  frame: { width: '100%', height: 200, backgroundColor: '#000' },
  nativeFrame: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  poster: { ...StyleSheet.absoluteFillObject },
  playOverlay: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  title: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  badge: { ...Typography.labelSm, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full, overflow: 'hidden' },
});
