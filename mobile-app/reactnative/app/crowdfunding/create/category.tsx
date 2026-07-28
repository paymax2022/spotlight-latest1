import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import { CAMPAIGN_CATEGORIES, INVESTMENT_ENABLED } from '@/features/crowdfunding/constants/crowdfunding.constants';

export default function CreateCategoryScreen() {
  const { draft, patch } = useCampaignDraft();
  const cats = INVESTMENT_ENABLED ? CAMPAIGN_CATEGORIES : CAMPAIGN_CATEGORIES.filter((c) => c.slug !== 'investment');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={2} totalSteps={9} title="Pick a category" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.sub}>Help supporters find your campaign and apply the right review checks.</Text>
        <View style={styles.grid}>
          {cats.map((c) => {
            const active = draft.category === c.slug;
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[c.icon] ?? Icons.Folder;
            return (
              <Pressable key={c.id} style={[styles.tile, active && styles.tileActive]} onPress={() => patch({ category: c.slug })} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Icon size={22} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
                <Text style={[styles.tileLabel, active && styles.tileLabelActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={() => router.push('/crowdfunding/create/details')} disabled={!draft.category} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { width: '31.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  tileActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  tileLabelActive: { color: Colors.onPrimary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
