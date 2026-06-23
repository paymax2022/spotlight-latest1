import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { HandHeart, Gift, Users, Store, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import type { CampaignType } from '@/features/crowdfunding/types/crowdfunding.types';

const TYPES: { value: CampaignType; label: string; desc: string; icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }> }[] = [
  { value: 'DONATION', label: 'Donation', desc: 'Raise money for a cause, person, or emergency — no reward expected.', icon: HandHeart },
  { value: 'REWARD', label: 'Reward / Project', desc: 'Offer backers rewards for funding a creative project or product.', icon: Gift },
  { value: 'COMMUNITY', label: 'Community', desc: 'Fund a shared community, association, or religious project.', icon: Users },
  { value: 'SME', label: 'SME / Business', desc: 'Raise capital to grow a small business or cooperative.', icon: Store },
];

export default function CreateTypeScreen() {
  const { draft, patch, reset } = useCampaignDraft();

  // Fresh start each time the wizard is entered from the dashboard.
  React.useEffect(() => { if (!draft.type) reset(); /* eslint-disable-next-line */ }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={1} totalSteps={9} title="What are you raising for?" onBack={() => router.dismissTo('/crowdfunding/creator')} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.sub}>Choose the campaign type that best fits your goal. This shapes the tools and checks we apply.</Text>
        {TYPES.map((t) => {
          const active = draft.type === t.value;
          const Icon = t.icon;
          return (
            <Pressable key={t.value} style={[styles.card, active && styles.cardActive]} onPress={() => patch({ type: t.value })} accessibilityRole="radio" accessibilityState={{ selected: active }}>
              <View style={[styles.iconBox, active && styles.iconBoxActive]}>
                <Icon size={22} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{t.label}</Text>
                <Text style={styles.cardDesc}>{t.desc}</Text>
              </View>
              {active && <Check size={20} color={Colors.primary} strokeWidth={2.6} />}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={() => router.push('/crowdfunding/create/category')} disabled={!draft.type} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, gap: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  cardActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  iconBox: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  iconBoxActive: { backgroundColor: Colors.primary },
  cardBody: { flex: 1 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
