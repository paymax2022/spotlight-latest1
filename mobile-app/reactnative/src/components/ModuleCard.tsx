import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

interface Props {
  label:       string;
  icon:        string;
  iconColor:   string;
  bgColor:     string;
  badge?:      string;
  comingSoon?: boolean;
  onPress:     () => void;
  /**
   * Home's essentials row: a smaller tile so four columns of long service names
   * ("Telemedicine") fit without breaking mid-word. Off by default, so All
   * Services and every other grid keeps the full-size tile.
   */
  compact?:    boolean;
}

export default function ModuleCard({ label, icon, iconColor, bgColor, badge, comingSoon, onPress, compact }: Props) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.LayoutGrid;

  return (
    <Pressable
      onPress={comingSoon ? undefined : onPress}
      style={({ pressed }) => [
        styles.container,
        comingSoon && styles.disabled,
        pressed && !comingSoon && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: comingSoon }}
      accessibilityLabel={comingSoon ? `${label} — coming soon` : label}
    >
      <View style={[styles.iconBox, compact && styles.iconBoxCompact, { backgroundColor: comingSoon ? Colors.surfaceContainerHigh : bgColor }]}>
        <IconComponent
          size={compact ? 21 : 24}
          color={comingSoon ? Colors.outline : iconColor}
          strokeWidth={1.8}
        />

        {/* Badge — only shown when not comingSoon */}
        {badge && !comingSoon && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}

        {/* Coming-soon lock pip */}
        {comingSoon && (
          <View style={styles.soonPip}>
            <Icons.Lock size={8} color={Colors.white} strokeWidth={2.5} />
          </View>
        )}
      </View>

      <Text
        style={[styles.label, compact && styles.labelCompact, comingSoon && styles.labelMuted]}
        numberOfLines={2}
      >
        {label}
      </Text>

      {comingSoon && (
        <Text style={styles.soonTag}>Soon</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems:      'center',
    gap:             Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity:   0.75,
    transform: [{ scale: 0.96 }],
  },
  iconBox: {
    width:          56,
    height:         56,
    borderRadius:   Radius.md,
    alignItems:     'center',
    justifyContent: 'center',
    position:       'relative',
  },
  badge: {
    position:          'absolute',
    top:               -4,
    right:             -4,
    backgroundColor:   Colors.error,
    borderRadius:      Radius.full,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  badgeText: {
    ...Typography.caption,
    color:      Colors.onError,
    fontSize:   9,
    fontWeight: '700',
  },
  soonPip: {
    position:        'absolute',
    top:             -4,
    right:           -4,
    width:           16,
    height:          16,
    borderRadius:    Radius.full,
    backgroundColor: Colors.outline,
    alignItems:      'center',
    justifyContent:  'center',
  },
  label: {
    ...Typography.labelSm,
    color:    Colors.onSurface,
    textAlign: 'center',
    maxWidth:  72,
  },
  // Prototype tile: 47px square. Radius.lg is the nearest token (15 vs 16 is not
  // visible at this size, and the codebase keeps corners on the scale).
  iconBoxCompact: {
    width:        47,
    height:       47,
    borderRadius: Radius.lg,
  },
  // 10px is what lets "Telemedicine" sit on one line inside a 390px-wide column;
  // at labelSm's 12px the word is wider than the cell and breaks mid-word.
  // labelSm carries no letterSpacing, so overriding fontSize needs no re-statement.
  labelCompact: {
    ...Typography.labelSm,
    fontSize:   10,
    lineHeight: 13,
    maxWidth:   86,
  },
  labelMuted: {
    color: Colors.outline,
  },
  soonTag: {
    ...Typography.caption,
    fontSize:          8,
    color:             Colors.outline,
    textTransform:     'uppercase',
    letterSpacing:     0.5,
  },
});
