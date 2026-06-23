import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  FlatList,
  TextInput,
  StyleSheet,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { ChevronDown, Check, Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface SelectFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  options: string[];
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  searchable?: boolean;
}

export default function SelectField({
  label,
  placeholder = 'Select an option',
  value,
  options,
  onChange,
  error,
  disabled = false,
  searchable = true,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const handleSelect = (item: string) => {
    onChange(item);
    setOpen(false);
    setQuery('');
  };

  const screenHeight = Dimensions.get('window').height;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[
          styles.trigger,
          !!error && styles.triggerError,
          disabled && styles.triggerDisabled,
        ]}
      >
        <Text
          style={[styles.triggerText, !value && styles.triggerPlaceholder]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={18} color={Colors.outline} strokeWidth={2} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <Pressable style={styles.backdrop} onPress={() => { setOpen(false); setQuery(''); }} />
          <View style={[styles.sheet, { maxHeight: screenHeight * 0.72 }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label ?? 'Select'}</Text>
              <Pressable
                onPress={() => { setOpen(false); setQuery(''); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            </View>

            {searchable && (
              <View style={styles.searchWrap}>
                <Search size={16} color={Colors.outline} strokeWidth={2} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search…"
                  placeholderTextColor={Colors.outline}
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {query.length > 0 && (
                  <Pressable onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={14} color={Colors.outline} strokeWidth={2} />
                  </Pressable>
                )}
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const selected = item === value;
                return (
                  <Pressable
                    onPress={() => handleSelect(item)}
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <Text
                      style={[styles.optionText, selected && styles.optionTextSelected]}
                      numberOfLines={1}
                    >
                      {item}
                    </Text>
                    {selected && (
                      <Check size={16} color={Colors.primary} strokeWidth={2.5} />
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No results for "{query}"</Text>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  wrapper: { marginBottom: Spacing.md },
  label:   { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  trigger: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   Colors.surfaceContainerLow,
    borderRadius:      Radius.lg,
    borderWidth:       1.5,
    borderColor:       Colors.transparent,
    height:            56,
    paddingHorizontal: Spacing.md,
  },
  triggerError:    { borderColor: Colors.error },
  triggerDisabled: { opacity: 0.5 },
  triggerText:        { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  triggerPlaceholder: { color: Colors.outline },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor:      Colors.surfaceContainerLowest,
    borderTopLeftRadius:  Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceContainerHigh,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sheetHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom:     Spacing.md,
  },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  searchWrap: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.sm,
    marginHorizontal:  Spacing.lg,
    marginBottom:      Spacing.sm,
    backgroundColor:   Colors.surfaceContainerLow,
    borderRadius:      Radius.lg,
    paddingHorizontal: Spacing.md,
    height:            48,
  },
  searchInput: {
    flex: 1,
    ...Typography.bodyMd,
    color: Colors.onSurface,
    padding: 0,
  },
  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  option: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerLow,
  },
  optionSelected: { backgroundColor: Colors.primaryFixed, marginHorizontal: -Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radius.md },
  optionText: {
    ...Typography.bodyMd,
    color: Colors.onSurface,
    flex: 1,
    marginRight: Spacing.sm,
  },
  optionTextSelected: { color: Colors.primary, fontWeight: '700' },
  emptyText: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
});
