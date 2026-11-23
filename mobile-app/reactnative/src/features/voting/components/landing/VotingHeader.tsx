import React from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Bell, User } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Stage, contentColumn } from './theme';

const LOGO = require('../../../../../assets/branding/favicon.png');
const BAR_HEIGHT = 58;

interface Props {
  /** Vertical scroll offset. Drives the transparent → paper transition. */
  scrollY: Animated.Value;
  topInset: number;
  userInitial?: string;
  /**
   * Renders the bar already settled on paper. The transparent state is for the
   * hero only: whenever there is no hero under it (first paint, a failed load)
   * a white wordmark would sit invisibly on the pale page.
   */
  pinnedSolid?: boolean;
}

/**
 * Section A — the shell's top bar. It floats transparently over the hero and
 * settles onto paper as the hero scrolls away. The wordmark is one text whose
 * ink is interpolated; the bell and its chip cross-fade, since an Svg icon
 * cannot take an animated `color` and a cross-fade keeps it tappable exactly
 * once in both states.
 */
export default function VotingHeader({ scrollY, topInset, userInitial, pinnedSolid }: Props) {
  const solid = scrollY.interpolate({
    inputRange: [40, 150],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const onDark = scrollY.interpolate({
    inputRange: [40, 150],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // One wordmark whose ink cross-fades, rather than two stacked copies: two
  // absolutely-positioned texts leave ghosted letters mid-transition.
  const wordColor = scrollY.interpolate({
    inputRange: [40, 150],
    outputRange: [Stage.white, Stage.ink],
    extrapolate: 'clamp',
  });

  const paperOpacity = pinnedSolid ? 1 : solid;
  const darkOpacity = pinnedSolid ? 0 : onDark;

  return (
    <View
      style={[styles.shell, { paddingTop: topInset, height: topInset + BAR_HEIGHT }]}
      pointerEvents="box-none"
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.paper, { opacity: paperOpacity }]} />
      <Animated.View style={[styles.hairline, { opacity: paperOpacity }]} />

      <View style={styles.row}>
        <Pressable
          onPress={() => router.push('/voting' as never)}
          style={styles.brand}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Spotlight Voting home"
        >
          <View style={styles.logoTile}>
            <Image source={LOGO} style={styles.logo} contentFit="contain" />
          </View>
          <Animated.Text style={[styles.word, { color: pinnedSolid ? Stage.ink : wordColor }]}>VOTING</Animated.Text>
        </Pressable>

        <View style={styles.controls}>
          <Pressable
            onPress={() => router.push('/voting/notifications' as never)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Voting notifications"
          >
            <View style={styles.iconBtn}>
              <Animated.View style={[styles.iconBtnBg, styles.iconBtnBgDark, { opacity: darkOpacity }]} />
              <Animated.View style={[styles.iconBtnBg, styles.iconBtnBgLight, { opacity: paperOpacity }]} />
              <Animated.View style={{ opacity: darkOpacity }}>
                <Bell size={19} color={Stage.white} strokeWidth={1.9} />
              </Animated.View>
              <Animated.View style={[styles.iconLayer, { opacity: paperOpacity }]}>
                <Bell size={19} color={Stage.ink} strokeWidth={1.9} />
              </Animated.View>
            </View>
          </Pressable>

          <Pressable
            onPress={() => router.push('/profile' as never)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Your profile"
          >
            <LinearGradient
              colors={['#F5A623', '#F4237B', '#5B21C9']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatar}
            >
              {userInitial ? (
                <Animated.Text style={styles.avatarInitial}>{userInitial}</Animated.Text>
              ) : (
                <User size={17} color={Stage.white} strokeWidth={2} />
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    justifyContent: 'center',
  },
  paper: { backgroundColor: Colors.background },
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.outlineVariant,
  },
  row: {
    ...contentColumn,
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoTile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Stage.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 26, height: 26 },
  word: {
    ...Typography.labelLg,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800' as const,
    letterSpacing: 2.6,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnBg: { ...StyleSheet.absoluteFillObject, borderRadius: Radius.full },
  iconBtnBgDark: { backgroundColor: 'rgba(255,255,255,0.16)' },
  iconBtnBgLight: { backgroundColor: Colors.surfaceContainerLow },
  iconLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    ...Typography.labelMd,
    fontSize: 15,
    fontWeight: '800' as const,
    color: Stage.white,
  },
});
