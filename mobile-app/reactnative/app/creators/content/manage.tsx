import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Plus, Lock, Play, ShieldAlert, X, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useMyContent, useCreateContent } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira } from '@/features/creators/constants/creators.constants';
import type { ContentKind, GatedContent } from '@/features/creators/types';
import { sanitizeMoneyInput } from '@/utils/money';

const KINDS: ContentKind[] = ['video', 'image', 'article', 'audio'];

export default function ContentManage() {
  const content = useMyContent();
  const create = useCreateContent();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ContentKind>('video');
  const [gated, setGated] = useState(true);
  const [price, setPrice] = useState('');
  const [adult, setAdult] = useState(false);

  const priceKobo = gated && price ? (parseInt(price.replace(/[^0-9]/g, ''), 10) || 0) * 100 : null;

  const submit = async () => {
    await create.mutateAsync({ title, kind, gated, priceKobo: priceKobo && priceKobo > 0 ? priceKobo : null, ageRestricted: adult });
    setOpen(false);
    setTitle(''); setPrice(''); setAdult(false); setGated(true); setKind('video');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Manage content</Text>
        <Pressable onPress={() => setOpen(true)} hitSlop={10} style={styles.iconBtn} accessibilityLabel="New content"><Plus size={22} color={Colors.onSurface} /></Pressable>
      </View>

      {content.isLoading ? (
        <StateView kind="loading" message="Loading content…" />
      ) : content.isError ? (
        <StateView kind="error" title="Couldn't load content" actionLabel="Retry" onAction={() => content.refetch()} />
      ) : (content.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No content yet" message="Publish your first post for fans." icon="Plus" actionLabel="New content" onAction={() => setOpen(true)} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {content.data!.map((c) => <ManageRow key={c.id} content={c} />)}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>New content</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}><X size={22} color={CreatorsColors.muted} /></Pressable>
            </View>
            <Text style={styles.label}>Title</Text>
            <TextInput style={styles.input} placeholder="e.g. Behind the scenes" placeholderTextColor={CreatorsColors.muted} value={title} onChangeText={setTitle} />
            <Text style={styles.label}>Type</Text>
            <View style={styles.kindRow}>
              {KINDS.map((k) => (
                <Pressable key={k} style={[styles.kindChip, kind === k && styles.kindChipSel]} onPress={() => setKind(k)}>
                  <Text style={[styles.kindText, kind === k && styles.kindTextSel]}>{k}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.toggleRow} onPress={() => setGated(!gated)}>
              <View style={[styles.checkbox, gated && styles.checkboxOn]}>{gated ? <Check size={14} color="#FFFFFF" /> : null}</View>
              <Text style={styles.toggleText}>Gated (subscribers / pay-per-view)</Text>
            </Pressable>
            {gated ? (
              <>
                <Text style={styles.label}>Pay-per-view price (₦, leave blank for subscriber-only)</Text>
                <TextInput style={styles.input} placeholder="e.g. 2500" placeholderTextColor={CreatorsColors.muted} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={price} onChangeText={(v) => setPrice(sanitizeMoneyInput(v))} />
              </>
            ) : null}
            <Pressable style={styles.toggleRow} onPress={() => setAdult(!adult)}>
              <View style={[styles.checkbox, adult && styles.checkboxOn]}>{adult ? <Check size={14} color="#FFFFFF" /> : null}</View>
              <Text style={styles.toggleText}>Mark as 18+ (age-gated, NL-11)</Text>
            </Pressable>
            <PrimaryButton label="Publish" onPress={submit} disabled={title.trim().length < 2} loading={create.isPending} style={{ marginTop: Spacing.md }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ManageRow({ content }: { content: GatedContent }) {
  return (
    <View style={styles.row}>
      <View style={[styles.thumb, { backgroundColor: content.thumbColor }]}>
        {content.gated ? <Lock size={16} color="#FFFFFF" /> : <Play size={16} color="#FFFFFF" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{content.title}</Text>
        <View style={styles.rowMeta}>
          <Text style={styles.rowMetaText}>{content.kind} · {content.gated ? (content.priceKobo ? formatNaira(content.priceKobo) : 'Subscriber') : 'Public'}</Text>
          {content.ageRestricted ? <View style={styles.ageChip}><ShieldAlert size={11} color={CreatorsColors.danger} /><Text style={styles.ageText}>18+</Text></View> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CreatorsColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  thumb: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.titleMd, color: CreatorsColors.text },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rowMetaText: { ...Typography.labelSm, color: CreatorsColors.muted, textTransform: 'capitalize' },
  ageChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: CreatorsColors.dangerBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full },
  ageText: { ...Typography.caption, color: CreatorsColors.danger },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.xl },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  sheetTitle: { ...Typography.titleLg, color: CreatorsColors.text },
  label: { ...Typography.labelMd, color: CreatorsColors.text, marginTop: Spacing.md, marginBottom: 6 },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: CreatorsColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: CreatorsColors.surface },
  kindRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  kindChip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5, borderColor: CreatorsColors.border },
  kindChipSel: { borderColor: CreatorsColors.brand, backgroundColor: CreatorsColors.brandBg },
  kindText: { ...Typography.labelMd, color: CreatorsColors.text, textTransform: 'capitalize' },
  kindTextSel: { color: CreatorsColors.brand },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, borderColor: CreatorsColors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: CreatorsColors.brand, borderColor: CreatorsColors.brand },
  toggleText: { ...Typography.bodyMd, color: CreatorsColors.text, flex: 1 },
});
