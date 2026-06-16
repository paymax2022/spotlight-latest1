import React, { useRef, useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet, TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props extends TextInputProps {
  label?:   string;
  error?:   string;
  leftIcon?: React.ReactNode;
  secure?:  boolean;
}

export default function TextInputField({ label, error, leftIcon, secure, style, ...rest }: Props) {
  const inputRef = useRef<TextInput>(null);
  const [focused,  setFocused]  = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { onFocus, onBlur, editable = true, ...inputProps } = rest;

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable
        style={[styles.container, focused && styles.focused, !!error && styles.errored]}
        onPress={() => inputRef.current?.focus()}
        disabled={!editable}
      >
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          ref={inputRef}
          {...inputProps}
          editable={editable}
          secureTextEntry={secure && !revealed}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, !!leftIcon && styles.inputWithIcon, style]}
          placeholderTextColor={Colors.outline}
        />
        {secure && (
          <Pressable onPress={() => setRevealed((r) => !r)} style={styles.rightIcon}>
            {revealed
              ? <EyeOff size={18} color={Colors.outline} />
              : <Eye     size={18} color={Colors.outline} />
            }
          </Pressable>
        )}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: {
    ...Typography.labelMd,
    color:         Colors.onSurface,
    marginBottom:  Spacing.xs,
  },
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius:    Radius.lg,
    borderWidth:     1.5,
    borderColor:     Colors.transparent,
    height:          56,
    paddingHorizontal: Spacing.md,
  },
  focused: {
    borderColor:     Colors.secondary,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  errored: {
    borderColor: Colors.error,
  },
  leftIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex:       1,
    ...Typography.bodyMd,
    color:      Colors.onSurface,
    padding:    0,
  },
  inputWithIcon: {
    marginLeft: 4,
  },
  rightIcon: {
    marginLeft: Spacing.sm,
    padding:    4,
  },
  error: {
    ...Typography.labelSm,
    color:      Colors.error,
    marginTop:  Spacing.xs,
  },
});
