import React, { useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldAlert, Plus, Trash2, X, Phone, IdCard, Car } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useAddBlacklist, useBlacklist, useRemoveBlacklist } from '@/features/visitor/hooks/useVisitor';
import { relativeTime } from '@/features/visitor/utils/visitorFormatters';
import { confirmAsync } from '@/lib/confirm';
import type { BlacklistMatchKind } from '@/features/visitor/types/visitor.types';

const KINDS: { kind: BlacklistMatchKind; label: string; Icon: typeof Phone }[] = [
  { kind: 'phone', label: 'Phone', Icon: Phone },
  { kind: 'id', label: 'ID', Icon: IdCard },
  { kind: 'plate', label: 'Plate', Icon: Car },
];

export default function BlacklistScreen() {
  const { data, isLoading, isError, refetch } = useBlacklist();
  const add = useAddBlacklist();
  const remove = useRemoveBlacklist();

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<BlacklistMatchKind>('phone');
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    if (!value.trim() || !reason.trim()) { setError('Match value and reason are required.'); return; }
    add.mutate(
      { matchKind: kind, matchValue: value.trim(), name: name.trim() || undefined, reason: reason.trim() },
      { onSuccess: () => { setAdding(false); setValue(''); setName(''); setReason(''); }, onError: (e) => setError(e instanceof Error ? e.message : 'Failed to add.') },
    );
  };

  const onRemove = async (id: string, label: string) => {
    const ok = await confirmAsync({ title: 'Remove from blacklist?', message: `${label} will be allowed entry again.`, confirmLabel: 'Remove', destructive: true });
    if (ok) remove.mutate(id);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Blacklist"
        subtitle="Estate-wide"
        rightSlot={
          <Pressable onPress={() => setAdding((v) => !v)} accessibilityRole="button" accessibilityLabel={adding ? 'Close' : 'Add entry'} hitSlop={8} style={styles.headerBtn}>
            {adding ? <X size={22} color={Colors.onSurface} /> : <Plus size={22} color={Colors.secondary} />}
          </Pressable>
        }
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {adding ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Match by</Text>
            <View style={styles.kindRow}>
              {KINDS.map((k) => {
                const selected = k.kind === kind;
                const { Icon } = k;
                return (
                  <Pressable key={k.kind} onPress={() => setKind(k.kind)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.kindChip, selected && styles.kindChipSelected]}>
                    <Icon size={16} color={selected ? Colors.onPrimary : Colors.secondary} strokeWidth={2} />
                    <Text style={[styles.kindText, selected && { color: Colors.onPrimary }]}>{k.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <PhoneNumberInput label="Value" value={value} onChange={({ e164, nsn }) => (setValue)(e164 || nsn)} />
            <TextInputField label="Name (optional)" placeholder="Visitor name" value={name} onChangeText={setName} autoCapitalize="words" />
            <TextInputField label="Reason" placeholder="Why is this person blacklisted?" value={reason} onChangeText={setReason} multiline numberOfLines={3} style={styles.reasonInput} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label="Add to blacklist" onPress={submit} loading={add.isPending} />
          </ScrollView>
        ) : isLoading ? (
          <StateView kind="loading" message="Loading blacklist…" />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        ) : (data?.length ?? 0) === 0 ? (
          <StateView kind="empty" icon="ShieldCheck" title="Blacklist is empty" message="Flagged visitors will appear here for every gate." actionLabel="Add entry" onAction={() => setAdding(true)} />
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {data!.map((b) => (
              <View key={b.id} style={styles.card}>
                <View style={styles.iconBox}><ShieldAlert size={20} color={Colors.error} strokeWidth={1.8} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{b.name ?? b.matchValue}</Text>
                  <Text style={styles.cardMeta}>{b.matchKind.toUpperCase()} · {b.matchValue}</Text>
                  <Text style={styles.cardReason} numberOfLines={2}>{b.reason}</Text>
                  <Text style={styles.cardTime}>Added {relativeTime(b.createdAt)}</Text>
                </View>
                <Pressable onPress={() => onRemove(b.id, b.name ?? b.matchValue)} accessibilityRole="button" accessibilityLabel="Remove" hitSlop={8} style={styles.removeBtn}>
                  <Trash2 size={18} color={Colors.error} strokeWidth={1.8} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  kindRow: { flexDirection: 'row', gap: Spacing.sm },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, minHeight: 44 },
  kindChipSelected: { backgroundColor: Colors.secondary },
  kindText: { ...Typography.labelMd, color: Colors.secondary },
  reasonInput: { minHeight: 80, textAlignVertical: 'top', paddingTop: Spacing.sm },
  error: { ...Typography.labelMd, color: Colors.error },
  card: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  cardName: { ...Typography.labelLg, color: Colors.onSurface },
  cardMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cardReason: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  cardTime: { ...Typography.labelSm, color: Colors.outline, marginTop: 2 },
  removeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: Colors.errorContainer },
});
