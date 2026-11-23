import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Sparkles } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow3 } from '@/constants/tokens';
import { BEAM_COLORS, Stage } from './theme';

interface Props {
  onExplore: () => void;
  onRegister: () => void;
  /** Sets the words and the action side by side instead of a full-width stack. */
  wide?: boolean;
}

/**
 * Section I. The curtain call. It answers the hero with the same light thrown
 * from the other corner, so the page opens and closes on the same stage. At
 * desktop widths the card is a marquee: the words hold the left half and the
 * gold button stops stretching across the other, so the light has room.
 */
export default function VotingCTA({ onExplore, onRegister, wide }: Props) {
  return (
    <View style={[styles.card, wide && styles.cardWide, shadow3]}>
      <LinearGradient
        colors={[Stage.nightSoft, Stage.nightDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[...BEAM_COLORS]}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0.1 }}
          style={styles.beam}
        />
        <View style={[styles.bokeh, { top: 26, right: 42, width: 7, height: 7, opacity: 0.5 }]} />
        <View style={[styles.bokeh, { top: 58, right: 86, width: 4, height: 4, opacity: 0.35 }]} />
      </View>

      <View style={wide ? styles.contentRow : undefined}>
        <View style={wide ? styles.textCol : undefined}>
          <View style={styles.eyebrowRow}>
            <Sparkles size={12} color={Stage.gold} strokeWidth={2.2} />
            <Text style={styles.eyebrow}>SPOTLIGHT VOTING</Text>
          </View>

          <Text style={[styles.title, wide && styles.titleWide]}>
            EVERY GREAT STAR NEEDS YOUR SUPPORT.
          </Text>
          <Text style={[styles.copy, wide && styles.copyWide]}>
            Join the Spotlight community. Discover talent, celebrate creativity and help shape the
            next big story.
          </Text>
        </View>

        <View style={wide ? styles.actionCol : undefined}>
          <Pressable
            onPress={onExplore}
            style={({ pressed }) => [styles.cta, wide && styles.ctaWide, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Explore all contests"
          >
            <Text style={styles.ctaText}>EXPLORE ALL CONTESTS</Text>
            <ArrowRight size={15} color={Stage.goldInk} strokeWidth={2.6} />
          </Pressable>

          <Pressable
            onPress={onRegister}
            hitSlop={8}
            style={styles.register}
            accessibilityRole="link"
            accessibilityLabel="Register to compete as a contestant"
          >
            <Text style={styles.registerText}>Are you a performer? </Text>
            <Text style={styles.registerLink}>Register to compete</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.containerMargin,
    borderRadius: Radius.xl,
    padding: 22,
    overflow: 'hidden',
  },
  cardWide: { padding: 28 },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
  },
  textCol: { flex: 1 },
  actionCol: { width: 248 },
  beam: {
    position: 'absolute',
    bottom: -240,
    left: -120,
    width: 320,
    height: 720,
    transform: [{ rotate: '22deg' }],
  },
  bokeh: {
    position: 'absolute',
    borderRadius: Radius.full,
    backgroundColor: Stage.gold,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  eyebrow: {
    ...Typography.labelSm,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800' as const,
    letterSpacing: 1.6,
    color: Stage.gold,
  },
  title: {
    ...Typography.headlineMd,
    fontSize: 25,
    lineHeight: 29,
    fontWeight: '800' as const,
    letterSpacing: -0.7,
    color: Stage.white,
    maxWidth: 290,
  },
  titleWide: { fontSize: 27, lineHeight: 32, maxWidth: 360 },
  copy: {
    ...Typography.bodySm,
    fontSize: 12.5,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 9,
    maxWidth: 300,
  },
  copyWide: { maxWidth: 340 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 48,
    borderRadius: 14,
    backgroundColor: Stage.gold,
    marginTop: 18,
  },
  ctaWide: { marginTop: 0 },
  ctaText: {
    ...Typography.labelSm,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
    color: Stage.goldInk,
  },
  pressed: { opacity: 0.86 },
  register: { flexDirection: 'row', justifyContent: 'center', marginTop: 14 },
  registerText: { ...Typography.bodySm, fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  registerLink: {
    ...Typography.labelSm,
    fontSize: 12,
    fontWeight: '700' as const,
    color: Stage.gold,
    textDecorationLine: 'underline',
  },
});
