import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Play } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  durationSecs: number;
  mine?:        boolean;          // doctor-authored bubble (tinted)
  onPlay?:      () => void;
}

// New component: a voice-note row with a play affordance, a static waveform and
// a duration label. MessageBubble only renders text + an attachment name; no
// existing component visualises an audio waveform, so this is genuinely new.
// The waveform bars are derived deterministically from the index so the demo
// renders without an audio dependency (no new npm deps).
const BAR_COUNT = 16;

export default function VoiceNoteBubble({ durationSecs, mine = false, onPlay }: Props) {
  const mm = String(Math.floor(durationSecs / 60)).padStart(2, '0');
  const ss = String(durationSecs % 60).padStart(2, '0');
  const tint = mine ? Colors.onPrimary : Colors.primary;

  const bars = Array.from({ length: BAR_COUNT }, (_, i) => 6 + Math.round(((Math.sin(i * 1.7) + 1) / 2) * 14));

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPlay}
        style={[styles.playBtn, mine ? styles.playBtnMine : styles.playBtnTheirs]}
        accessibilityRole="button"
        accessibilityLabel="Play voice note"
        hitSlop={6}
      >
        <Play size={16} color={mine ? Colors.primary : Colors.onPrimary} strokeWidth={2.4} fill={mine ? Colors.primary : Colors.onPrimary} />
      </Pressable>
      <View style={styles.waveform}>
        {bars.map((h, i) => (
          <View key={i} style={[styles.bar, { height: h, backgroundColor: tint, opacity: mine ? 0.85 : 0.55 }]} />
        ))}
      </View>
      <Text style={[styles.duration, { color: tint }]}>{mm}:{ss}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minWidth: 180 },
  playBtn:       { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  playBtnMine:   { backgroundColor: Colors.onPrimary },
  playBtnTheirs: { backgroundColor: Colors.primary },
  waveform:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 },
  bar:           { width: 2.5, borderRadius: Radius.full },
  duration:      { ...Typography.caption, fontWeight: '600' },
});
