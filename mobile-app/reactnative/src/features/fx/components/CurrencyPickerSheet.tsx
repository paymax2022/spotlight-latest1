import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, Pressable, FlatList, TextInput, StyleSheet,
  Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Check, Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CURRENCIES, CURRENCY_ORDER } from '../constants/fx.constants';
import { formatMoney } from '../utils/fxFormatters';
import type { CurrencyCode, WalletBalance } from '../types/fx.types';

interface Props {
  visible: boolean;
  value?: CurrencyCode;
  options?: CurrencyCode[];
  balances?: WalletBalance[];     // optional: show balance under each currency
  disabled?: CurrencyCode[];      // e.g. exclude the opposite side of a pair
  title?: string;
  onSelect: (currency: CurrencyCode) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet currency picker. Built new because the shared SelectField only
 * handles plain string[] — currencies need flag + name + (optional) balance.
 * Reuses SelectField's exact sheet anatomy (handle, header, search, list) and
 * tokens so it is visually indistinguishable.
 */
export default function CurrencyPickerSheet({
  visible, value, options, balances, disabled, title = 'Select currency', onSelect, onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const list = options ?? CURRENCY_ORDER;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.toLowerCase().includes(q) || CURRENCIES[c].name.toLowerCase().includes(q));
  }, [list, query]);

  const screenHeight = Dimensions.get('window').height;
  const close = () => { setQuery(''); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, { maxHeight: screenHeight * 0.78 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Search size={16} color={Colors.outline} strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search currency…"
              placeholderTextColor={Colors.outline}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="characters"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={14} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const meta = CURRENCIES[item];
              const selected = item === value;
              const isDisabled = disabled?.includes(item);
              const bal = balances?.find((b) => b.currency === item);
              return (
                <Pressable
                  onPress={() => { if (!isDisabled) { onSelect(item); close(); } }}
                  disabled={isDisabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: isDisabled }}
                  style={[styles.option, isDisabled && styles.optionDisabled]}
                >
                  <Text style={styles.flag}>{meta.flag}</Text>
                  <View style={styles.optMid}>
                    <Text style={styles.code}>{meta.code}</Text>
                    <Text style={styles.name} numberOfLines={1}>{meta.name}</Text>
                  </View>
                  {bal ? (
                    <Text style={styles.balance}>{formatMoney(bal.available, item)}</Text>
                  ) : null}
                  {selected ? <Check size={18} color={Colors.primary} strokeWidth={2.5} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>No currency matches "{query}"</Text>}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 40,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh,
    alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.xs,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, height: 48,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow,
  },
  optionDisabled: { opacity: 0.4 },
  flag: { fontSize: 26 },
  optMid: { flex: 1 },
  code: { ...Typography.labelLg, color: Colors.onSurface },
  name: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginRight: Spacing.sm },
  empty: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.xl },
});
