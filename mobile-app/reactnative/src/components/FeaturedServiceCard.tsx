import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

interface Props {
  title:     string;
  subtitle:  string;
  icon:      string;
  iconColor: string;
  bgColor:   string;
  onPress:   () => void;
}

export default function FeaturedServiceCard({ title, subtitle, icon, iconColor, bgColor, onPress }: Props) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.Star;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
        <IconComponent size={22} color={iconColor} strokeWidth={1.8} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    marginBottom:    Spacing.sm,
    borderWidth:     1,
    borderColor:     Colors.surfaceContainerHigh,
    gap:             Spacing.md,
  },
  pressed: {
    opacity: 0.8,
  },
  iconBox: {
    width:          48,
    height:         48,
    borderRadius:   Radius.md,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  text: {
    flex: 1,
  },
  title: {
    ...Typography.labelMd,
    color: Colors.onSurface,
  },
  subtitle: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginTop: 2,
  },
});
