import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, MapPin, Vote } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { Stage } from './theme';
import type { Contestant } from '../../types/voting.types';

interface Props {
  contestant: Contestant;
  contestTitle: string;
  /** Overrides the rail width — the wide layout's 3-up grid sets its own. */
  width?: number;
  onPress: () => void;
  onVote: () => void;
}

/**
 * Section E's portrait. The photograph is the card; the name sits in the night
 * at its foot with the contestant's real rank as a gold number, because on a
 * stage the number IS the story. The footer names the contest they are in, so
 * one shelf can mix rosters from several competitions without ambiguity.
 */
export default function ContestantWatchCard({
  contestant,
  contestTitle,
  width,
  onPress,
  onVote,
}: Props) {
  const displayName = contestant.stageName ?? contestant.name;
  const rank = contestant.rank > 0 ? String(contestant.rank).padStart(2, '0') : null;
  // A wider card needs a taller portrait or the face turns into a letterbox.
  const photoHeight = width ? Math.round(width * 1.12) : 196;

  return (
    <View style={[styles.card, shadow1, width ? { width } : null]}>
      {/* One tap target per control: the portrait opens the profile and the
          footer's VOTE chip is its own target. Nesting the chip inside the
          card's Pressable renders a <button> inside a <button> on web. */}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.photoWrap, { height: photoHeight }, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${displayName}, ${contestTitle}`}
      >
        {/* The monogram is the floor, not the fallback: a portrait that is
            absent or fails to load still leaves a face-sized mark. */}
        <LinearGradient
          colors={[Stage.nightSoft, Stage.violet, Stage.nightDeep]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.initialWrap]}
        >
          <Text style={styles.initial}>{displayName.charAt(0).toUpperCase()}</Text>
        </LinearGradient>
        {contestant.photo ? (
          <Image
            source={{ uri: contestant.photo }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            cachePolicy="disk"
            alt={displayName}
          />
        ) : null}
        <LinearGradient
          colors={['rgba(12,3,25,0)', 'rgba(12,3,25,0.20)', 'rgba(12,3,25,0.88)']}
          locations={[0.35, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />

        {rank ? (
          <View style={styles.rank}>
            <Text style={styles.rankNum}>{rank}</Text>
          </View>
        ) : null}

        <View style={styles.nameBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {displayName}
            </Text>
            {contestant.isVerified ? (
              <BadgeCheck size={13} color={Stage.gold} fill={Stage.gold} strokeWidth={0} />
            ) : null}
          </View>
          <View style={styles.placeRow}>
            {contestant.state ? (
              <>
                <MapPin size={10} color="rgba(255,255,255,0.7)" strokeWidth={2} />
                <Text style={styles.place}>{contestant.state}</Text>
              </>
            ) : null}
            {contestant.state && contestant.category ? (
              <Text style={styles.placeDot}>·</Text>
            ) : null}
            {contestant.category ? <Text style={styles.place}>{contestant.category}</Text> : null}
          </View>
        </View>
      </Pressable>

      <View style={styles.footer}>
        <Text style={styles.contestTitle} numberOfLines={1}>
          {contestTitle}
        </Text>
        <Pressable
          onPress={onVote}
          hitSlop={6}
          style={({ pressed }) => [styles.vote, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Vote for ${displayName}`}
        >
          <Vote size={11} color={Stage.goldInk} strokeWidth={2.4} />
          <Text style={styles.voteText}>VOTE</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 172,
    backgroundColor: Stage.card,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Stage.hairline,
  },
  pressed: { opacity: 0.9 },
  photoWrap: { height: 196, position: 'relative', backgroundColor: Stage.night },
  initialWrap: { alignItems: 'center', justifyContent: 'center' },
  initial: {
    ...Typography.displayLg,
    fontSize: 62,
    lineHeight: 70,
    color: 'rgba(255,255,255,0.30)',
    textAlign: 'center',
  },
  rank: {
    position: 'absolute',
    top: 10,
    left: 10,
    minWidth: 26,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: Radius.sm,
    backgroundColor: Stage.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNum: {
    ...Typography.labelSm,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
    color: Stage.goldInk,
  },
  nameBlock: { position: 'absolute', left: 11, right: 11, bottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: {
    ...Typography.labelMd,
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
    color: Stage.white,
    flexShrink: 1,
  },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  place: { ...Typography.caption, fontSize: 10.5, lineHeight: 13, color: 'rgba(255,255,255,0.72)' },
  placeDot: { fontSize: 10.5, color: 'rgba(255,255,255,0.45)' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  contestTitle: {
    ...Typography.caption,
    fontSize: 10.5,
    lineHeight: 13,
    color: Stage.muted,
    flex: 1,
  },
  vote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: Radius.full,
    backgroundColor: Stage.gold,
  },
  voteText: {
    ...Typography.labelSm,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.7,
    color: Stage.goldInk,
  },
});
