import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin, Navigation } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  height?: number;
  caption?: string;
  showRoute?: boolean;
  style?: ViewStyle;
}

/**
 * Placeholder for the live map. The real map view comes from the shared maps
 * adapter (react-native-maps / Mapbox) injected later; this keeps every map
 * surface visually consistent with the design system until then.
 */
export default function MapPlaceholder({ height = 200, caption, showRoute, style }: Props) {
  return (
    <View style={[styles.wrap, { height }, style]}>
      <LinearGradient
        colors={[Colors.surfaceContainer, Colors.surfaceContainerHighest]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* faux grid */}
      <View style={styles.grid} pointerEvents="none">
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: `${(i + 1) * 16}%` }]} />
        ))}
        {Array.from({ length: 5 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLineV, { left: `${(i + 1) * 16}%` }]} />
        ))}
      </View>

      {showRoute && (
        <>
          <View style={[styles.pin, { top: '28%', left: '24%' }]}>
            <View style={styles.pinDotStart} />
          </View>
          <View style={styles.routeLine} />
          <View style={[styles.pin, { bottom: '24%', right: '22%' }]}>
            <MapPin size={26} color={Colors.primary} strokeWidth={2.2} fill={Colors.primaryFixed} />
          </View>
        </>
      )}

      {!showRoute && (
        <View style={styles.center}>
          <Navigation size={26} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
        </View>
      )}

      {caption ? (
        <View style={styles.captionWrap}>
          <Text style={styles.caption}>{caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainer },
  grid: { ...StyleSheet.absoluteFillObject },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(11,28,48,0.05)' },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(11,28,48,0.05)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pin: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  pinDotStart: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.secondary, borderWidth: 3, borderColor: Colors.white },
  routeLine: {
    position: 'absolute', top: '32%', left: '28%', width: '46%', height: 3,
    backgroundColor: Colors.secondary, opacity: 0.5, borderRadius: 2,
    transform: [{ rotate: '24deg' }],
  },
  captionWrap: {
    position: 'absolute', bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: Radius.md,
    paddingVertical: 6, paddingHorizontal: Spacing.sm, alignItems: 'center',
  },
  caption: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
