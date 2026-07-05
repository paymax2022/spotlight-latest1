import React, { useRef, useState } from 'react';
import { View, TextInput, StyleSheet, Pressable } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  placeholder?: string;
  value?:       string;
  onChangeText?: (text: string) => void;
  onPress?:     () => void;          // if readonly (navigates to search screen)
  onSubmit?:    (text: string) => void;  // fired on keyboard "search" action
  editable?:    boolean;
  autoFocus?:   boolean;
}

export default function SearchBar({ placeholder = 'Search services, payments, bookings...', value, onChangeText, onPress, onSubmit, editable = true, autoFocus = false }: Props) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      onPress={editable ? () => inputRef.current?.focus() : onPress}
      style={[styles.container, focused && styles.focused]}
      pointerEvents={editable ? 'auto' : 'box-only'}
    >
      <Search size={18} color={focused ? Colors.secondary : Colors.outline} strokeWidth={1.8} />
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={Colors.outline}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={(e) => onSubmit?.(e.nativeEvent.text)}
        editable={editable}
        autoFocus={autoFocus}
        returnKeyType="search"
      />
      {value ? (
        <Pressable onPress={() => onChangeText?.('')} hitSlop={8}>
          <X size={16} color={Colors.outline} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius:    Radius.full,
    borderWidth:     1.5,
    borderColor:     Colors.transparent,
    paddingHorizontal: Spacing.md,
    height:          48,
    marginHorizontal: Spacing.containerMargin,
    marginBottom:    Spacing.md,
  },
  focused: {
    borderColor:     Colors.secondary,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  input: {
    flex:   1,
    ...Typography.bodyMd,
    color:  Colors.onSurface,
    padding: 0,
  },
});
