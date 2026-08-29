import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react-native';
import { confirmAsync } from '@/lib/confirm';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import StateView from '@/components/StateView';
import {
  useBillerStore,
  BILLER_CATEGORIES,
  CATEGORY_PRESET,
  type BillerCategory,
  type SavedBiller,
} from '@/features/services/billerStore';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';

function BillerIcon({ name, color }: { name: string; color: string }) {
  const Cmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Receipt;
  return <Cmp size={18} color={color} strokeWidth={2} />;
}

export default function BeneficiariesScreen() {
  const billers = useBillerStore((s) => s.billers);
  const add = useBillerStore((s) => s.add);
  const remove = useBillerStore((s) => s.remove);

  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<BillerCategory>('Airtime');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');

  const preset = CATEGORY_PRESET[category];
  const ready = title.trim().length >= 2 && target.replace(/\s+/g, '').length >= 4;

  const resetForm = () => { setTitle(''); setTarget(''); setCategory('Airtime'); };

  const save = () => {
    if (!ready) return;
    add({ category, title, target });
    resetForm();
    setAdding(false);
  };

  const confirmDelete = async (biller: SavedBiller) => {
    const ok = await confirmAsync({
      title: 'Remove beneficiary',
      message: `Remove "${biller.title}" from your saved billers?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) remove(biller.id);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/services')} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Beneficiaries</Text>
        <Pressable
          onPress={() => setAdding((v) => !v)}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={adding ? 'Close add form' : 'Add beneficiary'}
        >
          <Plus size={20} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Saved billers</Text>
            <Text style={styles.noticeText}>Beneficiaries saved during payment appear here for repeat airtime, data, electricity, and cable purchases.</Text>
          </View>

          {adding ? (
            <View style={[styles.card, shadow1]}>
              <Text style={styles.formTitle}>New beneficiary</Text>
              <SelectField label="Category" value={category} options={BILLER_CATEGORIES} searchable={false} onChange={(v) => setCategory(v as BillerCategory)} />
              <TextInputField label="Name" value={title} onChangeText={setTitle} placeholder="e.g. MTN Airtime" autoCapitalize="words" />
              <TextInputField label={preset.targetLabel} value={target} onChangeText={setTarget} placeholder={preset.targetPlaceholder} keyboardType="number-pad" />
              <View style={styles.formActions}>
                <PrimaryButton label="Cancel" variant="secondary" onPress={() => { resetForm(); setAdding(false); }} fullWidth={false} style={styles.flexBtn} />
                <PrimaryButton label="Save" onPress={save} disabled={!ready} fullWidth={false} style={styles.flexBtn} />
              </View>
            </View>
          ) : null}

          {billers.length === 0 && !adding ? (
            <StateView kind="empty" icon="Users" title="No saved billers" message="Add a biller to pay airtime, data, electricity or cable in one tap." actionLabel="Add beneficiary" onAction={() => setAdding(true)} compact />
          ) : billers.length > 0 ? (
            <View style={[styles.card, shadow1]}>
              {billers.map((biller, index) => (
                <View key={biller.id}>
                  <View style={styles.row}>
                    <View style={[styles.iconBox, { backgroundColor: biller.bg }]}>
                      <BillerIcon name={biller.icon} color={biller.accent} />
                    </View>
                    <View style={styles.copy}>
                      <Text style={styles.title}>{biller.title}</Text>
                      <Text style={styles.sub}>{biller.subtitle}</Text>
                    </View>
                    <Pressable
                      onPress={() => confirmDelete(biller)}
                      style={styles.deleteBtn}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${biller.title}`}
                    >
                      <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                    </Pressable>
                  </View>
                  {index < billers.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          ) : null}

          {!adding ? <PrimaryButton label="Add Beneficiary" variant="secondary" onPress={() => setAdding(true)} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  topBar: { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.lg },
  notice: { backgroundColor: Colors.primaryFixed, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.primaryContainer },
  noticeTitle: { ...Typography.titleMd, color: Colors.primary },
  noticeText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  formTitle: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  formActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs, marginBottom: Spacing.sm },
  flexBtn: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { ...Typography.labelMd, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  deleteBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
