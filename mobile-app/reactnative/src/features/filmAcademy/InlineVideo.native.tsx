// ── Inline video — NATIVE implementation ─────────────────────────────────────
// iOS/Android counterpart of InlineVideo.tsx. Same contract, WebView instead of
// an iframe. react-native-webview is already a dependency (the Paystack sheet
// and the mobility map use it), so this adds no new package.

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { Play, ExternalLink } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { youtubeEmbedUrl } from './youtube';
import type { InlineVideoProps } from './InlineVideo';

function ExternalFallback({ url, label }: InlineVideoProps) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url).catch(() => {})}
      style={styles.fallback}
      accessibilityRole="link"
    >
      <ExternalLink size={16} color={Colors.gold} />
      <Text style={styles.fallbackText} numberOfLines={2}>
        {label || 'Open resource'} — opens outside Spotlight
      </Text>
    </Pressable>
  );
}

export function InlineVideo({ url, label }: InlineVideoProps) {
  const embed = youtubeEmbedUrl(url);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  if (!embed) return <ExternalFallback url={url} label={label} />;

  return (
    <View style={styles.wrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.frame}>
        {playing ? (
          <>
            <WebView
              source={{ uri: embed }}
              style={styles.web}
              // Without this the video hands off to the system full-screen player,
              // which is the "leaves the app" behaviour this component exists to fix.
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              // Keep navigation inside the player: a tap on a related video or a
              // channel link would otherwise wander off mid-lesson.
              onShouldStartLoadWithRequest={(req) =>
                req.url.startsWith('https://www.youtube-nocookie.com/') ||
                req.url.startsWith('https://www.youtube.com/embed/') ||
                req.url === embed
              }
              onLoadEnd={() => setLoading(false)}
            />
            {loading && (
              <View style={styles.loading}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            )}
          </>
        ) : (
          <Pressable onPress={() => setPlaying(true)} style={styles.poster} accessibilityRole="button">
            <View style={styles.playBadge}>
              <Play size={22} color={Colors.black} />
            </View>
            <Text style={styles.posterText}>Play here — you stay in Spotlight</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:   { gap: Spacing.xs, marginTop: Spacing.sm },
  label:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  frame:  { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.md,
            overflow: 'hidden', backgroundColor: Colors.surfaceVariant },
  web:    { flex: 1, backgroundColor: 'transparent' },
  loading:{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  poster: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  playBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.gold,
               alignItems: 'center', justifyContent: 'center' },
  posterText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fallback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
              backgroundColor: Colors.surface, borderRadius: Radius.md,
              padding: Spacing.lg, marginTop: Spacing.sm },
  fallbackText: { ...Typography.labelLg, color: Colors.gold, flex: 1 },
});
