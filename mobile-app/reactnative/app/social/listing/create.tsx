import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateListing, ESCROW_DISCLOSURE } from '@/features/social/escrow';
import { SocialColors } from '@/features/social/constants/social.constants';
import type { ListingCondition } from '@/features/social/escrow';
import { sanitizeMoneyInput } from '@/utils/money';
import { HomeMenuButton } from '@/components/HomeMenu';

const CONDITIONS: ListingCondition[] = ['new', 'used', 'refurbished'];
const CATEGORIES = ['Phones', 'Gaming', 'Fashion', 'Home', 'Electronics', 'Other'];

export default function CreateListing() {
  const create = useCreateListing();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [condition, setCondition] = useState<ListingCondition>('used');
  const [category, setCategory] = useState('Phones');
  const [location, setLocation] = useState('');
  const [done, setDone] = useState(false);

  const priceKobo = (parseInt(price.replace(/[^0-9]/g, ''), 10) || 0) * 100;
  const valid = title.trim().length > 2 && priceKobo > 0 && location.trim().length > 1;

  const submit = async () => {
    await create.mutateAsync({ title, description, priceKobo, condition, category, location });
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => goBack('/social')} hitSlop={10} style={styles.iconBtn}><ArrowLeft size={22} color={Colors.onSurface} /></Pressable><Text style={styles.headerTitle}>Listed</Text><View style={styles.iconBtn} /></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <StateView kind="empty" icon="CheckCircle2" title="Listing published" message="Your item is now live in the marketplace. Buyers pay into escrow." actionLabel="Browse marketplace" onAction={() => router.replace('/social/listing/browse')} />
          <HomeMenuButton />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/social')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>New listing</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={styles.iconBtn} />
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>Title</Text>
        <TextInput style={styles.input} placeholder="e.g. iPhone 13 Pro" placeholderTextColor={SocialColors.muted} value={title} onChangeText={setTitle} />
        <Text style={styles.label}>Description</Text>
        <TextInput style={[styles.input, styles.multiline]} placeholder="Condition, accessories, etc." placeholderTextColor={SocialColors.muted} value={description} onChangeText={setDescription} multiline />
        <Text style={styles.label}>Price (₦)</Text>
        <TextInput style={styles.input} placeholder="0" placeholderTextColor={SocialColors.muted} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={price} onChangeText={(t) => setPrice(sanitizeMoneyInput(t))} />

        <Text style={styles.label}>Condition</Text>
        <View style={styles.chipRow}>
          {CONDITIONS.map((c) => (
            <Pressable key={c} style={[styles.chip, condition === c && styles.chipSel]} onPress={() => setCondition(c)}><Text style={[styles.chipText, condition === c && styles.chipTextSel]}>{c}</Text></Pressable>
          ))}
        </View>

        <Text style={styles.label}>Category</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} style={[styles.chip, category === c && styles.chipSel]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextSel]}>{c}</Text></Pressable>
          ))}
        </View>

        <Text style={styles.label}>Location</Text>
        <TextInput style={styles.input} placeholder="e.g. Lagos" placeholderTextColor={SocialColors.muted} value={location} onChangeText={setLocation} />

        <View style={styles.disclosure}><Text style={styles.disclosureText}>{ESCROW_DISCLOSURE}</Text></View>

        <PrimaryButton label="Publish listing" onPress={submit} disabled={!valid} loading={create.isPending} style={{ marginTop: Spacing.md }} />
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  label: { ...Typography.labelMd, color: SocialColors.text, marginTop: Spacing.md, marginBottom: 6 },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: SocialColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: SocialColors.surface },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5, borderColor: SocialColors.border, backgroundColor: SocialColors.surface },
  chipSel: { borderColor: SocialColors.brand, backgroundColor: Colors.iconBgPurple },
  chipText: { ...Typography.labelMd, color: SocialColors.text, textTransform: 'capitalize' },
  chipTextSel: { color: SocialColors.brand },
  disclosure: { backgroundColor: SocialColors.warnBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  disclosureText: { ...Typography.labelSm, color: SocialColors.warnText },
});
