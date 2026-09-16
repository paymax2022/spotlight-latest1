// ── Inline video — WEB implementation ────────────────────────────────────────
// Metro picks this file on web and InlineVideo.native.tsx on iOS/Android, the
// same split the payments gateway uses.
//
// The point of this component is that a learner never leaves Spotlight to watch
// a lesson. The previous behaviour called Linking.openURL, which handed them to
// the YouTube app or a new browser tab and lost their place in the course.

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { Play, ExternalLink } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { youtubeEmbedUrl } from './youtube';

export interface InlineVideoProps {
  url: string;
  /** Shown above the player. */
  label?: string;
}

/**
 * Not every stored link is an embeddable video — a resource may be a PDF or an
 * article, and arbitrary sites refuse to be framed (X-Frame-Options). Rather than
 * render a silently blank box, an unembeddable link falls back to an explicit
 * "opens outside Spotlight" affordance so the departure is the learner's choice.
 */
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
  // The player is mounted only after a tap: a lesson with three videos would
  // otherwise load three YouTube players on render, which is slow and starts
  // network traffic for videos the learner may never watch.
  const [playing, setPlaying] = useState(false);

  if (!embed) return <ExternalFallback url={url} label={label} />;

  return (
    <View style={styles.wrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.frame}>
        {playing ? (
          // react-native-web renders to the DOM, so a real iframe is available
          // here. createElement avoids needing the DOM lib in tsconfig.
          React.createElement('iframe', {
            src: embed,
            title: label || 'Lesson video',
            allow: 'accelerometer; encrypted-media; picture-in-picture; fullscreen',
            allowFullScreen: true,
            frameBorder: '0',
            style: { width: '100%', height: '100%', border: 0, borderRadius: 8 },
          })
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
  // 16:9 keeps the player the shape of the video on every screen width.
  frame:  { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.md,
            overflow: 'hidden', backgroundColor: Colors.surfaceVariant },
  poster: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  playBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.gold,
               alignItems: 'center', justifyContent: 'center' },
  posterText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fallback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
              backgroundColor: Colors.surface, borderRadius: Radius.md,
              padding: Spacing.lg, marginTop: Spacing.sm },
  fallbackText: { ...Typography.labelLg, color: Colors.gold, flex: 1 },
});
