import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Lock, LockOpen } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useCreateVault } from '@/features/savings/hooks';
import { SavingsColors, NO_YIELD_DISCLOSURE, formatNaira } from '@/features/savings/constants/savings.constants';

const EMOJIS = ['☔️', '🚗', '🏖️', '🎓', '🏠', '💍', '🎁', '💰'];

export default function CreateVault() {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [targetNaira, setTargetNaira] = useState('');
  const [lock, setLock] = useState<'LOCKED' | 'FLEX'>('FLEX');
  const [initialNaira, setInitialNaira] = useState('');
  const create = useCreateVault();

  const targetKobo = targetNaira ? Math.round(parseFloat(targetNaira) * 100) : null;
  const initialKobo = initialNaira ? Math.round(parseFloat(initialNaira) * 100) : 0;
  const valid = name.trim().length >= 2;

  const submit = async () => {
    if (!valid) return;
    try {
      const v = await create.mutateAsync({ name: name.trim(), targetKobo, lock, initialKobo });
      router.replace(`/savings/vault/${v.id}`);
    } catch {
      Alert.alert('Could not create vault', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create vault" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Choose an icon</Text>
        <View style={styles.emojiRow}>
          {EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.emojiBtn, emoji === e && styles.emojiBtnActive]}>
              <Text style={styles.emoji}>{e}</Text>
            </Pressable>
          ))}
        </View>

        <TextInputField label="Vault name" placeholder="e.g. New Car" value={name} onChangeText={setName} />
        <TextInputField label="Target amount (optional)" placeholder="0" keyboardType="numeric" value={targetNaira} onChangeText={setTargetNaira} />
        <TextInputField label="Initial deposit (optional)" placeholder="0" keyboardType="numeric" value={initialNaira} onChangeText={setInitialNaira} />

        <Text style={styles.label}>Savings type</Text>
        <View style={styles.typeRow}>
          <TypeCard
            active={lock === 'FLEX'} onPress={() => setLock('FLEX')}
            Icon={LockOpen} title="Flexible" desc="Withdraw anytime, no penalty."
          />
          <TypeCard
            active={lock === 'LOCKED'} onPress={() => setLock('LOCKED')}
            Icon={Lock} title="Locked" desc="Locked till a date; early break has a fee."
          />
        </View>

        {targetKobo ? <Text style={styles.hint}>Target: {formatNaira(targetKobo)}</Text> : null}

        <DisclosureBanner text={NO_YIELD_DISCLOSURE} />

        <PrimaryButton label="Create vault" onPress={submit} loading={create.isPending} disabled={!valid} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function TypeCard({ active, onPress, Icon, title, desc }: { active: boolean; onPress: () => void; Icon: typeof Lock; title: string; desc: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.typeCard, active && styles.typeCardActive]}>
      <Icon size={20} color={active ? SavingsColors.brand : SavingsColors.muted} strokeWidth={2} />
      <Text style={[styles.typeTitle, active && { color: SavingsColors.brand }]}>{title}</Text>
      <Text style={styles.typeDesc}>{desc}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  emojiBtn: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: SavingsColors.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  emojiBtnActive: { borderColor: SavingsColors.brand, backgroundColor: SavingsColors.surface },
  emoji: { fontSize: 24 },
  typeRow: { flexDirection: 'row', gap: Spacing.sm },
  typeCard: { flex: 1, gap: 6, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: SavingsColors.surface, borderWidth: 2, borderColor: SavingsColors.border },
  typeCardActive: { borderColor: SavingsColors.brand },
  typeTitle: { ...Typography.titleMd, color: Colors.onSurface },
  typeDesc: { ...Typography.bodySm, color: SavingsColors.muted },
  hint: { ...Typography.bodySm, color: SavingsColors.muted },
});
