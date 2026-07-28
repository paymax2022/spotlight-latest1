import React from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Lightbulb } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';

const TIPS = ['Who needs help and why?', 'How will the funds be used?', 'What happens if you don’t reach the goal?'];

export default function CreateStoryScreen() {
  const { draft, patch } = useCampaignDraft();
  const valid = draft.story.trim().length >= 80;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={4} totalSteps={9} title="Tell your story" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.tipCard}>
            <Lightbulb size={16} color={Colors.primary} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.tipTitle}>A good story covers:</Text>
              {TIPS.map((t) => <Text key={t} style={styles.tipItem}>•  {t}</Text>)}
            </View>
          </View>

          <TextInput
            style={styles.editor}
            placeholder="Share the full story behind your campaign…"
            placeholderTextColor={Colors.outline}
            value={draft.story}
            onChangeText={(t) => patch({ story: t })}
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{draft.story.trim().length} characters (minimum 80)</Text>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Continue" onPress={() => router.push('/crowdfunding/create/media')} disabled={!valid} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  tipCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  tipTitle: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: 2 },
  tipItem: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  editor: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 220, ...Typography.bodyMd, color: Colors.onSurface },
  counter: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
