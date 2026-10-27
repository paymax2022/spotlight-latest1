import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';

// Line-art palette: everything is drawn with the app's own outline/muted tokens
// so the illustration reads as part of the design system instead of a sticker.
const INK = '#9AA3B2';
const LEAF = Colors.tertiaryFixed;
const BUBBLE = Colors.secondaryFixed;

const CLOUD = 'M4,18 C-2,18 -2,8 6,8 C6,1 17,-2 21,4 C26,-1 37,2 35,10 C42,10 43,18 37,18 Z';
// A frond that starts at the crown and droops: the outward sweep and the
// downward tip are what make it read as a palm rather than a flower petal.
const FROND = 'M0,0 C 15,-7 32,-5 45,5 C 30,3 13,5 0,0 Z';

function Sparkle({ x, y }: { x: number; y: number }) {
  return (
    <G stroke={INK} strokeWidth={1.6} strokeLinecap="round">
      <Line x1={x - 5} y1={y} x2={x + 5} y2={y} />
      <Line x1={x} y1={y - 5} x2={x} y2={y + 5} />
    </G>
  );
}

/**
 * The "stranded on a quiet island" scene: nothing to vote on, nobody in a hurry.
 * Pull-to-refresh is the only action this screen offers, so the picture carries
 * the apologetic tone the plain text version could not.
 */
function IslandIllustration({ size = 250 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.7} viewBox="0 0 240 168">
      <Sparkle x={104} y={14} />
      <Sparkle x={180} y={30} />
      <G transform="translate(58,24) scale(0.95)">
        <Path d={CLOUD} stroke={INK} strokeWidth={1.9} fill="none" strokeLinejoin="round" />
      </G>
      <G transform="translate(138,8) scale(0.72)">
        <Path d={CLOUD} stroke={INK} strokeWidth={2.4} fill="none" strokeLinejoin="round" />
      </G>
      <Circle cx={126} cy={44} r={3} fill={INK} opacity={0.35} />
      <Circle cx={196} cy={86} r={5} stroke={INK} strokeWidth={1.6} fill="none" opacity={0.5} />

      {/* Boat, waiting offshore */}
      <G transform="translate(2,84)" stroke={INK} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round">
        <Path d="M0,16 L46,16 L37,26 L9,26 Z" />
        <Path d="M11,16 L11,6 L27,6 L27,16" />
        <Line x1={-6} y1={32} x2={54} y2={32} />
      </G>

      {/* Island */}
      <Path d="M60,130 C 74,86 178,86 192,130" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <Line x1={44} y1={130} x2={208} y2={130} stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1={66} y1={139} x2={186} y2={139} stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
      <Line x1={88} y1={148} x2={162} y2={148} stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.45} />

      {/* Palm */}
      <Path d="M148,128 C 148,102 154,82 168,66" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <G transform="translate(168,66)">
        <Circle cx={-4} cy={5} r={3.4} fill={LEAF} stroke={INK} strokeWidth={1.2} />
        <Circle cx={5} cy={6} r={3.4} fill={LEAF} stroke={INK} strokeWidth={1.2} />
        {[-160, -120, -85, -45, -10].map((a) => (
          <G key={a} transform={`rotate(${a})`}>
            <Path d={FROND} fill={LEAF} fillOpacity={0.65} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
          </G>
        ))}
      </G>

      {/* Person, keeping calm */}
      <Circle cx={100} cy={102} r={21} fill={BUBBLE} fillOpacity={0.45} stroke={INK} strokeWidth={2} />
      <Circle cx={100} cy={96} r={7} stroke={INK} strokeWidth={2} fill="none" />
      <Path d="M88,114 C 91,105 109,105 112,114" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

interface Props {
  title?: string;
  message?: string;
  compact?: boolean;
}

/**
 * Empty state for "there is nothing to vote on". Used by the voting home and the
 * contest list so both say the same thing in the same voice, and both point at
 * the one gesture that can change the answer.
 */
export default function NoContestsState({
  title = 'No live contests right now…',
  message = 'Keep calm, light a fire and pull down to refresh. New Spotlight contests open here.',
  compact,
}: Props) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <IslandIllustration size={compact ? 215 : 250} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
    gap: Spacing.md,
  },
  compact: { paddingVertical: Spacing.xl },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
