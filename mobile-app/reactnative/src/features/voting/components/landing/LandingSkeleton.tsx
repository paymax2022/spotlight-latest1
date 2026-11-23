import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Stage, contentColumn } from './theme';

/**
 * The first paint, before any contest lands. It keeps the page's silhouette —
 * a tall stage, a title stack, a poster rail — so nothing jumps when the real
 * content replaces it.
 */
export default function LandingSkeleton({ topInset }: { topInset: number }) {
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }}>
      <View style={[styles.hero, { paddingTop: topInset + 58 + Spacing.md }]}>
        <View style={styles.heroInner}>
          <View style={[styles.block, styles.kicker]} />
          <View style={[styles.block, { width: 250, height: 30, marginTop: 16 }]} />
          <View style={[styles.block, { width: 196, height: 30, marginTop: 8 }]} />
          <View style={[styles.block, { width: 130, height: 30, marginTop: 8 }]} />
          <View style={[styles.block, { width: '88%', height: 12, marginTop: 16 }]} />
          <View style={[styles.block, { width: '66%', height: 12, marginTop: 7 }]} />
          <View style={[styles.block, styles.ticket]} />
          <View style={styles.ctaRow}>
            <View style={[styles.block, styles.ctaPrimary]} />
            <View style={[styles.block, styles.ctaSecondary]} />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={[styles.block, { width: 90, height: 10 }]} />
        <View style={[styles.block, { width: 210, height: 20, marginTop: 8 }]} />
        <View style={styles.rail}>
          <View style={[styles.block, styles.poster]} />
          <View style={[styles.block, styles.poster]} />
        </View>
      </View>
    </Animated.View>
  );
}

const BLOCK = 'rgba(255,255,255,0.16)';

const styles = StyleSheet.create({
  hero: {
    backgroundColor: Stage.night,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    paddingBottom: 24,
  },
  heroInner: { ...contentColumn, paddingHorizontal: Spacing.containerMargin },
  block: { backgroundColor: BLOCK, borderRadius: Radius.sm },
  kicker: { width: 96, height: 22, borderRadius: Radius.full },
  ticket: { height: 58, borderRadius: Radius.lg, marginTop: 18, backgroundColor: 'rgba(255,255,255,0.10)' },
  ctaRow: { flexDirection: 'row', gap: 9, marginTop: 16 },
  ctaPrimary: { flex: 1.35, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,197,61,0.28)' },
  ctaSecondary: { flex: 1, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)' },
  section: {
    ...contentColumn,
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.sectionGap,
  },
  rail: { flexDirection: 'row', gap: Spacing.md, marginTop: 14 },
  poster: {
    width: 252,
    height: 322,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceContainerHigh,
  },
});
