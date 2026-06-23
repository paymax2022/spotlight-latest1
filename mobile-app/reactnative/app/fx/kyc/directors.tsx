import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Trash2, UserCog } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { kycDraft } from '@/features/fx/utils/kycDraft';
import type { DirectorUbo } from '@/features/fx/types/fx.types';

export default function KybDirectorsScreen() {
  const [directors, setDirectors] = useState<DirectorUbo[]>(
    kycDraft.current.directors.length ? kycDraft.current.directors : [{ name: '', role: 'Director', ownershipPct: '', idNumber: '' }],
  );

  const update = (i: number, patch: Partial<DirectorUbo>) =>
    setDirectors((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const add = () => setDirectors((prev) => [...prev, { name: '', role: 'Director', ownershipPct: '', idNumber: '' }]);
  const remove = (i: number) => setDirectors((prev) => prev.filter((_, idx) => idx !== i));

  const ready = directors.every((d) => d.name.trim() && d.idNumber.trim() && d.ownershipPct.trim());

  const next = () => {
    kycDraft.current.directors = directors;
    router.push('/fx/kyc/documents');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Directors & UBOs" subtitle="KYB · 2 of 3" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>Add each director and any ultimate beneficial owner holding 25% or more.</Text>

          {directors.map((d, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitleRow}>
                  <UserCog size={16} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.cardTitle}>Person {i + 1}</Text>
                </View>
                {directors.length > 1 ? (
                  <Pressable onPress={() => remove(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove person ${i + 1}`}>
                    <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                  </Pressable>
                ) : null}
              </View>
              <TextInputField label="Full name" value={d.name} onChangeText={(t) => update(i, { name: t })} placeholder="Full legal name" autoCapitalize="words" />
              <TextInputField label="Role" value={d.role} onChangeText={(t) => update(i, { role: t })} placeholder="e.g. Director, CEO" autoCapitalize="words" />
              <TextInputField label="Ownership %" value={d.ownershipPct} onChangeText={(t) => update(i, { ownershipPct: t })} placeholder="e.g. 40" keyboardType="number-pad" />
              <TextInputField label="ID number (BVN/NIN/Passport)" value={d.idNumber} onChangeText={(t) => update(i, { idNumber: t })} placeholder="Government ID number" autoCapitalize="characters" />
            </View>
          ))}

          <Pressable style={styles.addBtn} onPress={add} accessibilityRole="button">
            <Plus size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.addText}>Add another person</Text>
          </Pressable>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Continue" onPress={next} disabled={!ready} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.secondary },
  addText: { ...Typography.labelLg, color: Colors.secondary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
