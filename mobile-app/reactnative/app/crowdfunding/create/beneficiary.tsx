import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';

const RELATIONSHIPS = ['Myself', 'Family member', 'Friend', 'Community', 'Organisation'];

export default function CreateBeneficiaryScreen() {
  const { draft, patch } = useCampaignDraft();
  const valid = draft.beneficiaryName.trim().length > 1 && draft.beneficiaryRelationship.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={7} totalSteps={9} title="Who benefits?" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.banner}>
            <ShieldCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.bannerText}>Naming the beneficiary builds trust and speeds up verification. Sensitive details stay private.</Text>
          </View>

          <TextInputField label="Beneficiary name" placeholder="Full name of the person/group benefiting" value={draft.beneficiaryName} onChangeText={(t) => patch({ beneficiaryName: t })} />

          <Text style={styles.label}>Your relationship to them</Text>
          <View style={styles.chipRow}>
            {RELATIONSHIPS.map((r) => {
              const active = draft.beneficiaryRelationship === r;
              return (
                <Pressable key={r} style={[styles.chip, active && styles.chipActive]} onPress={() => patch({ beneficiaryRelationship: r })} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Continue" onPress={() => router.push('/crowdfunding/create/budget')} disabled={!valid} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  banner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 9 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
