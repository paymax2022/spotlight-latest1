// ── Insurance (live) — loading skeletons ────────────────────────────────────
// A spinner tells a person "wait"; a skeleton tells them what is about to
// arrive. The catalog and policy lists are the two places worth the difference,
// because both are the first thing a user sees on entering the module.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { InsuranceColors } from '../../constants/insurance.constants';

/** A single shimmering block. */
export function SkeletonBlock({
  width,
  height,
  radius = Radius.DEFAULT,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: radius,
          backgroundColor: Colors.surfaceContainerHigh,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/** Placeholder matching the shape of a `LiveProductCard`. */
export function ProductCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonBlock width={44} height={44} radius={Radius.md} />
        <View style={styles.grow}>
          <SkeletonBlock width="70%" height={14} />
          <SkeletonBlock width="45%" height={11} style={{ marginTop: Spacing.xs }} />
        </View>
      </View>
      <SkeletonBlock width="100%" height={1} radius={0} />
      <View style={styles.row}>
        <SkeletonBlock width={90} height={18} />
        <View style={styles.grow} />
        <SkeletonBlock width={64} height={18} radius={Radius.full} />
      </View>
    </View>
  );
}

export function ProductListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** Placeholder matching the shape of a policy row. */
export function PolicyCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <SkeletonBlock width="60%" height={15} />
          <SkeletonBlock width="35%" height={11} style={{ marginTop: Spacing.xs }} />
        </View>
        <SkeletonBlock width={60} height={22} radius={Radius.full} />
      </View>
      <SkeletonBlock width="80%" height={12} />
    </View>
  );
}

export function PolicyListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => (
        <PolicyCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** Placeholder for a text-heavy detail screen. */
export function DetailSkeleton() {
  return (
    <View style={styles.list}>
      <SkeletonBlock width="100%" height={132} radius={Radius.xl} />
      <SkeletonBlock width="55%" height={18} />
      <SkeletonBlock width="100%" height={13} />
      <SkeletonBlock width="92%" height={13} />
      <SkeletonBlock width="78%" height={13} />
      <SkeletonBlock width="100%" height={96} radius={Radius.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  grow: { flex: 1 },
});
