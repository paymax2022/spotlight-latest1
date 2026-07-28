import React from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

interface Props {
  label:     string;
  onPress:   () => void;
  variant?:  'primary' | 'secondary' | 'ghost' | 'danger';
  loading?:  boolean;
  disabled?: boolean;
  style?:    ViewStyle;
  fullWidth?: boolean;
}

export default function PrimaryButton({ label, onPress, variant = 'primary', loading, disabled, style, fullWidth = true }: Props) {
  const isPrimary   = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isDanger    = variant === 'danger';
  const isGhost     = !isPrimary && !isSecondary && !isDanger;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary   && styles.primary,
        isSecondary && styles.secondary,
        isDanger    && styles.danger,
        isGhost     && styles.ghost,
        fullWidth && { width: '100%' },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={isSecondary || isGhost ? Colors.primary : Colors.onPrimary} size="small" />
        : <Text style={[styles.label, isSecondary && styles.labelSecondary, isGhost && styles.labelGhost]}>{label}</Text>
      }
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height:         56,
    borderRadius:   Radius.lg,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  secondary: {
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth:     1.5,
    borderColor:     Colors.secondary,
  },
  danger: {
    backgroundColor: Colors.error,
  },
  ghost: {
    backgroundColor: Colors.transparent,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    ...Typography.labelLg,
    color: Colors.onPrimary,
  },
  labelSecondary: {
    color: Colors.secondary,
  },
  labelGhost: {
    color: Colors.teal,
  },
});
