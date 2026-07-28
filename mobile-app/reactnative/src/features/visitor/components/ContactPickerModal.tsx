import React, { useState } from 'react';
import { Modal, View, Text, Pressable, FlatList, TextInput, StyleSheet, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { Search, X, User } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useContacts } from '../hooks/useContacts';
import type { PhonebookContact } from '../types/visitor.types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (contact: PhonebookContact) => void;
}

/**
 * Phonebook contact picker (bottom sheet) — mirrors the SelectField sheet
 * pattern. Reads the device address book via expo-contacts (with permission),
 * falling back to the seed phonebook when unavailable/denied. `onSelect` returns
 * the chosen { name, phone }.
 */
export default function ContactPickerModal({ visible, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const { data, isLoading } = useContacts(query);
  const screenHeight = Dimensions.get('window').height;

  const pick = (c: PhonebookContact) => {
    onSelect(c);
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={() => { setQuery(''); onClose(); }} />
        <View style={[styles.sheet, { maxHeight: screenHeight * 0.75 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Choose from contacts</Text>
            <Pressable onPress={() => { setQuery(''); onClose(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Search size={16} color={Colors.outline} strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search contacts…"
              placeholderTextColor={Colors.outline}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}><X size={14} color={Colors.outline} strokeWidth={2} /></Pressable>
            ) : null}
          </View>

          {isLoading ? (
            <StateView kind="loading" compact message="Loading contacts…" />
          ) : (
            <FlatList
              data={data ?? []}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Pressable onPress={() => pick(item)} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.phone}`} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <View style={styles.avatar}><User size={18} color={Colors.primary} strokeWidth={1.8} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.phone} numberOfLines={1}>{item.phone}</Text>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={<StateView kind="empty" icon="UserX" title="No contacts" message={`Nothing matches "${query.trim()}".`} compact />}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, paddingBottom: 40 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, height: 48 },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelMd, color: Colors.onSurface },
  phone: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
