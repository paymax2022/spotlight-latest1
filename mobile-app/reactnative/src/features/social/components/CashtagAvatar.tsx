import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { SocialColors } from '../constants/social.constants';

interface Props {
  name?:       string;
  handle?:     string;
  color:       string;
  size?:       number;
  verified?:   boolean;
}

/** Coloured initials avatar for a cashtag identity, with optional verified tick. */
export default function CashtagAvatar({ name, handle, color, size = 44, verified }: Props) {
  const source = name?.trim() || handle?.replace('@', '') || '?';
  const initials = source.slice(0, 1).toUpperCase();
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials}</Text>
      {verified ? (
        <View style={styles.badge}>
          <Check size={9} color="#FFFFFF" strokeWidth={3} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  initials: { ...Typography.labelLg, color: '#FFFFFF' },
  badge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: Radius.full,
    backgroundColor: SocialColors.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#FFFFFF',
  },
});
