import React from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Heart } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { VotingColors } from '../constants/voting.constants';

interface Props {
  onPress: () => void;
  label?: string;
  variant?: 'primary' | 'free' | 'paid' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
}

export default function VoteButton({ onPress, label = 'Vote', variant = 'primary', size = 'md', disabled, loading }: Props) {
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const bgColor = variant === 'free'
    ? VotingColors.freeVote
    : variant === 'paid'
    ? Colors.secondary
    : variant === 'outline'
    ? Colors.transparent
    : Colors.primary;

  const textColor = variant === 'outline' ? Colors.primary : Colors.onPrimary;
  const borderColor = variant === 'outline' ? Colors.primary : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bgColor, borderColor },
        variant === 'outline' && styles.outline,
        isSm && styles.sm,
        isLg && styles.lg,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          <Heart size={isSm ? 12 : isLg ? 18 : 14} color={textColor} strokeWidth={2} fill={textColor} />
          <Text style={[styles.label, { color: textColor }, isSm && styles.labelSm, isLg && styles.labelLg]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    height:         44,
    borderRadius:   Radius.lg,
    paddingHorizontal: 20,
    borderWidth:    0,
  },
  outline:  { borderWidth: 1.5 },
  sm:       { height: 34, paddingHorizontal: 14, borderRadius: Radius.md, gap: 4 },
  lg:       { height: 56, paddingHorizontal: 28, gap: 8 },
  disabled: { opacity: 0.45 },
  pressed:  { opacity: 0.82 },
  label:    { ...Typography.labelMd, fontWeight: '700' as const },
  labelSm:  { fontSize: 12 },
  labelLg:  { fontSize: 16 },
});
