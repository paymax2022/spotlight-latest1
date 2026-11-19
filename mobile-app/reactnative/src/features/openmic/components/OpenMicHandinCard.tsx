// The bridge from an approved Open Mic application to the beat and the song.
//
// Registration already tells the applicant where they stand in the review, and
// voting already tells them they are on the roster — but nothing in the app said
// "your beat is published, download it" or "your file is stored but voters
// cannot hear it until you submit". That gap is what made the flow unusable on a
// phone: the two actions lived on the web page only.
//
// The card is deliberately quiet about what it does not know. It asks the same
// eligibility endpoint the hand-in screen asks, so the status screen and the
// hand-in screen cannot disagree, and it renders the plain row whenever that
// read has not answered yet — the tap, not the card, is where a failure gets
// explained.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Music } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { describeStage } from '../state';
import { useOpenMicStage } from '../hooks';

interface Props {
  /** The edition slug from the applicant's own registration draft. */
  contestSlug: string;
  /** Sent along so backing out of the hand-in screen returns here, not to the app root. */
  applicationId?: string;
}

/** Kinds where the artist has something to do before their song goes live. */
const ACTIONABLE = new Set(['ready_to_upload', 'needs_submit', 'window_closed']);

export default function OpenMicHandinCard({ contestSlug, applicationId }: Props) {
  const { stage } = useOpenMicStage(contestSlug);
  const needsAction = ACTIONABLE.has(stage.kind);
  const copy = describeStage(stage);

  const params = applicationId
    ? `contestSlug=${encodeURIComponent(contestSlug)}&applicationId=${encodeURIComponent(applicationId)}`
    : `contestSlug=${encodeURIComponent(contestSlug)}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the Open Mic beat and song hand-in"
      onPress={() => router.push(`/openmic?${params}` as never)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Music size={18} color={Colors.primary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Your beat and your song</Text>
        <Text style={styles.body} numberOfLines={2}>
          {needsAction ? `Needs your action — ${copy.title}.` : copy.title}
        </Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  pressed: { opacity: 0.85 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
