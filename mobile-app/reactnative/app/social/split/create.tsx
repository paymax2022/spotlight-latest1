import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, X, AtSign } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import { useCreateSplit } from '@/features/social/hooks';
import { SocialColors, formatNaira, normalizeHandle, CASHTAG_REGEX } from '@/features/social/constants/social.constants';
import { sanitizeMoneyInput } from '@/utils/money';

type Mode = 'equal' | 'custom';

export default function CreateSplit() {
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [mode, setMode] = useState<Mode>('equal');
  const [handles, setHandles] = useState<string[]>(['@you']);
  const [newHandle, setNewHandle] = useState('');
  const create = useCreateSplit();

  const totalKobo = total ? Math.round(parseFloat(total) * 100) : 0;
  const perHeadKobo = handles.length > 0 ? Math.floor(totalKobo / handles.length) : 0;

  const addHandle = () => {
    const h = normalizeHandle(newHandle);
    if (!CASHTAG_REGEX.test(newHandle) || handles.includes(h)) return;
    setHandles((prev) => [...prev, h]);
    setNewHandle('');
  };
  const removeHandle = (h: string) => setHandles((prev) => prev.filter((x) => x !== h));

  const valid = title.trim().length >= 2 && totalKobo > 0 && handles.length >= 2;

  const submit = async () => {
    if (!valid) return;
    const participants = handles.map((h) => ({ handle: h, amountKobo: perHeadKobo }));
    try {
      const s = await create.mutateAsync({ title: title.trim(), totalKobo, mode, participants });
      router.replace(`/social/split/${s.id}`);
    } catch {
      Alert.alert('Could not create split', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Split a bill" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInputField label="What's it for?" placeholder="e.g. Dinner @ Nok" value={title} onChangeText={setTitle} />
        <TextInputField label="Total amount" placeholder="0" keyboardType="decimal-pad" maxLength={13} value={total} onChangeText={(t) => setTotal(sanitizeMoneyInput(t))} />

        <Text style={styles.label}>How to split</Text>
        <SegmentedControl<Mode> options={[{ value: 'equal', label: 'Equally' }, { value: 'custom', label: 'Custom' }]} value={mode} onChange={setMode} />

        <Text style={styles.label}>People ({handles.length})</Text>
        <View style={styles.chips}>
          {handles.map((h) => (
            <View key={h} style={styles.chip}>
              <Text style={styles.chipText}>{h}</Text>
              {h !== '@you' ? (
                <Pressable onPress={() => removeHandle(h)} hitSlop={6}><X size={14} color={SocialColors.muted} /></Pressable>
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.addRow}>
          <View style={{ flex: 1 }}>
            <TextInputField placeholder="@cashtag" autoCapitalize="none" autoCorrect={false} value={newHandle} onChangeText={setNewHandle} onSubmitEditing={addHandle} leftIcon={<AtSign size={18} color={SocialColors.muted} />} />
          </View>
          <Pressable onPress={addHandle} style={styles.addBtn}><Plus size={20} color="#FFFFFF" /></Pressable>
        </View>

        {valid ? (
          <Text style={styles.hint}>
            {mode === 'equal' ? `${formatNaira(perHeadKobo)} each` : 'Adjust each share on the next screen'} · total {formatNaira(totalKobo)}
          </Text>
        ) : null}

        <PrimaryButton label="Create split" onPress={submit} disabled={!valid} loading={create.isPending} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: SocialColors.surfaceAlt, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full },
  chipText: { ...Typography.labelMd, color: SocialColors.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addBtn: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: SocialColors.brand, alignItems: 'center', justifyContent: 'center' },
  hint: { ...Typography.bodySm, color: SocialColors.muted },
});
