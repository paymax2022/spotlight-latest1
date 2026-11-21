// One audio row, two uses: the applicant hearing the official beat before they
// record, and a voter hearing the finished song on a contestant profile.
//
// `expo-audio` owns the native player, which is the only surface in this app that
// plays a remote MP3 on both platforms — `expo-av` is deprecated in SDK 54 and
// `Linking.openURL` would leave the app to play a song.
//
// Two rules the component keeps:
//   • A new `url` must not need a remount. The hook binds the source once, so a
//     changed address goes through `replace()` — otherwise the second contestant
//     you tap plays the first one's song.
//   • Nothing is shown as progress that the player did not report. The track and
//     the two time labels read `currentTime`/`duration` from the status object,
//     and while the file has not reported a duration they render empty instead
//     of animating a guess.

import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Music2, Pause, Play } from 'lucide-react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatDuration } from '../constants';

interface Props {
  /** Absolute, device-reachable URL. Null renders the "nothing to play" line. */
  url: string | null;
  label: string;
  caption?: string;
  /** `song` reads as the contestant's track, `beat` as the official instrumental. */
  kind?: 'beat' | 'song';
  disabled?: boolean;
  style?: object;
}

/**
 * iOS stops a plain audio item the moment the ring/silent switch is set to
 * silent, so a voter or an artist on a muted phone would hear nothing and read
 * that as a broken song. The audio session is app-wide state, so it is applied
 * once per process rather than on every mount, and a failed call un-sets the
 * flag so the next player can retry.
 *
 * Nothing else is asked for: no recording permission, no background playback. A
 * profile player is a foreground, speaker-only consumer.
 */
let audioModeApplied = false;
function ensurePlayableAudioMode(): void {
  if (audioModeApplied) return;
  audioModeApplied = true;
  setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    shouldPlayInBackground: false,
  }).catch(() => {
    audioModeApplied = false;
  });
}

export default function SongPlayer({ url, label, caption, kind = 'song', disabled = false, style }: Props) {
  const player = useAudioPlayer(url ?? null);
  const status = useAudioPlayerStatus(player);
  const lastUrl = useRef<string | null>(url ?? null);

  useEffect(() => {
    if (Platform.OS === 'web' || !url) return;
    ensurePlayableAudioMode();
  }, [url]);

  useEffect(() => {
    const next = url ?? null;
    if (next === lastUrl.current) return;
    lastUrl.current = next;
    // `replace` resets the loaded item; the previous track stops with it, which is
    // what a listener expects when they tap a different song.
    player.replace(next);
  }, [player, url]);

  const playing = Boolean(status.playing);
  const seconds = Number.isFinite(status.currentTime) ? status.currentTime : 0;
  const total = Number.isFinite(status.duration) ? status.duration : 0;
  const progress = total > 0 ? Math.min(1, Math.max(0, seconds / total)) : 0;

  if (!url) {
    return (
      <View style={[styles.row, style]}>
        <View style={styles.art}>
          <Music2 size={18} color={Colors.outline} />
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.caption}>No audio is available for this entry yet.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
        disabled={disabled}
        onPress={() => (playing ? player.pause() : player.play())}
        style={({ pressed }) => [styles.art, pressed && styles.artPressed, disabled && styles.dimmed]}
      >
        {playing
          ? <Pause size={18} color={Colors.onPrimary} fill={Colors.onPrimary} />
          : <Play size={18} color={Colors.onPrimary} fill={Colors.onPrimary} style={{ marginLeft: 2 }} />}
      </Pressable>

      <View style={styles.textBlock}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.caption} numberOfLines={1}>
          {caption ?? (status.isLoaded
            ? `${formatDuration(seconds)} / ${total > 0 ? formatDuration(total) : '--:--'}`
            : 'Loading audio…')}
        </Text>
        <View style={styles.track} accessibilityElementsHidden>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>

      {kind === 'beat' && status.isBuffering ? (
        <Text style={styles.buffering}>buffering…</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  art: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artPressed: { opacity: 0.85 },
  dimmed: { opacity: 0.4 },
  textBlock: { flex: 1, gap: 2 },
  label: { ...Typography.bodyMd, color: Colors.onSurface },
  caption: { ...Typography.caption, color: Colors.onSurfaceVariant },
  track: {
    height: 3,
    borderRadius: Radius.full,
    backgroundColor: Colors.outlineVariant,
    marginTop: 4,
    overflow: 'hidden',
  },
  fill: { height: 3, borderRadius: Radius.full, backgroundColor: Colors.teal },
  buffering: { ...Typography.caption, color: Colors.outline },
});
