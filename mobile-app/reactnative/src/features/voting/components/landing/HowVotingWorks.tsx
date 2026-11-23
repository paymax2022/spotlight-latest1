import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Mic2, Vote } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { Stage } from './theme';

interface Step {
  index: string;
  title: string;
  copy: string;
  icon: LucideIcon;
}

const STEPS: Step[] = [
  {
    index: '01',
    title: 'DISCOVER',
    copy: 'Explore exciting competitions and discover emerging talents.',
    icon: Mic2,
  },
  {
    index: '02',
    title: 'CHOOSE',
    copy: 'Visit contestant profiles and select your favourite performers.',
    icon: Heart,
  },
  {
    index: '03',
    title: 'VOTE',
    copy: 'Cast your vote and support the talents you believe deserve to win.',
    icon: Vote,
  },
];

interface Props {
  /** Lays the three stops across the card instead of down it. */
  wide?: boolean;
}

/**
 * Section H. Numbered because this really is a sequence — you cannot vote for
 * someone you have not chosen. The dotted spine between the stops is the only
 * line on the screen; it exists to carry the eye from one step to the next. At
 * desktop widths the card is wide enough for a stack to read as one tall
 * column of loose text, so the spine turns horizontal and the steps sit
 * shoulder to shoulder — the same sequence, read left to right.
 */
export default function HowVotingWorks({ wide }: Props) {
  return (
    <View style={[styles.card, wide && styles.cardWide, shadow1]}>
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const last = i === STEPS.length - 1;
        return (
          <View key={step.index} style={wide ? styles.stepWide : styles.step}>
            <View style={wide ? styles.railWide : styles.rail}>
              <LinearGradient
                colors={['#FFD873', Stage.goldDeep]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.stop}
              >
                <Icon size={18} color={Stage.goldInk} strokeWidth={2.2} />
              </LinearGradient>
              {!last ? <View style={wide ? styles.connectorWide : styles.connector} /> : null}
            </View>

            <View style={[styles.body, !wide && !last && styles.bodyGap, wide && styles.bodyWide]}>
              <View style={styles.titleRow}>
                <Text style={styles.index}>{step.index}</Text>
                <Text style={styles.title}>{step.title}</Text>
              </View>
              <Text style={styles.copy}>{step.copy}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Stage.card,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Stage.hairline,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  cardWide: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  step: { flexDirection: 'row', gap: 14 },
  stepWide: { flex: 1 },
  rail: { alignItems: 'center', width: 40 },
  railWide: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  stop: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    flex: 1,
    width: 0,
    minHeight: 22,
    marginVertical: 6,
    borderLeftWidth: 2,
    borderStyle: 'dotted',
    borderColor: 'rgba(240,165,0,0.55)',
  },
  connectorWide: {
    flex: 1,
    height: 0,
    minWidth: 24,
    marginHorizontal: 10,
    borderTopWidth: 2,
    borderStyle: 'dotted',
    borderColor: 'rgba(240,165,0,0.55)',
  },
  body: { flex: 1, paddingTop: 2 },
  bodyWide: { paddingTop: 14 },
  bodyGap: { paddingBottom: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  index: {
    ...Typography.labelSm,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
    color: Stage.goldDeep,
  },
  title: {
    ...Typography.labelMd,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800' as const,
    letterSpacing: 1.1,
    color: Stage.ink,
  },
  copy: {
    ...Typography.bodySm,
    fontSize: 12.5,
    lineHeight: 18,
    color: Stage.muted,
    marginTop: 4,
  },
});
