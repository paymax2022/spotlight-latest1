import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  label:     string;
  icon:      string;
  iconColor: string;
  bgColor:   string;
  badge?:    string;
  onPress:   () => void;
}

export default function ModuleCard({ label, icon, iconColor, bgColor, badge, onPress }: Props) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.LayoutGrid;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
        <IconComponent size={24} color={iconColor} strokeWidth={1.8} />
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems:  'center',
    gap:         Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  pressed: {
    opacity: 0.75,
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
    position:        'absolute',
    top:             -4,
    right:           -4,
    backgroundColor: Colors.error,
    borderRadius:    Radius.full,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: {
    ...Typography.caption,
    color:       Colors.onError,
    fontSize:    9,
    fontWeight:  '700',
  },
  label: {
    ...Typography.labelSm,
    color:       Colors.onSurface,
    textAlign:   'center',
    maxWidth:    72,
  },
});
