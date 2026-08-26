import React from 'react';
import { ScrollView, View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';

const TITLE_MAX = 70;
const SUMMARY_MAX = 40;

export default function CreateDetailsScreen() {
  const { draft, patch } = useCampaignDraft();
  const valid = draft.title.trim().length >= 8 && draft.summary.trim().length >= 20;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={3} totalSteps={9} title="Name your campaign" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TextInputField
            label="Campaign title"
            placeholder="e.g. Help Baby Zara get heart surgery"
            value={draft.title}
            onChangeText={(t) => patch({ title: t.slice(0, TITLE_MAX) })}
            maxLength={TITLE_MAX}
          />
          <Text style={styles.counter}>{draft.title.length}/{TITLE_MAX} · a clear, specific title raises more.</Text>

          <View style={{ height: Spacing.md }} />

          <TextInputField
            label="Short summary"
            placeholder="One short line supporters see first."
            value={draft.summary}
            onChangeText={(t) => patch({ summary: t.slice(0, SUMMARY_MAX) })}
            multiline
            maxLength={SUMMARY_MAX}
            style={styles.multiline}
          />
          <Text style={styles.counter}>{draft.summary.length}/{SUMMARY_MAX}</Text>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Continue" onPress={() => router.push('/crowdfunding/create/story')} disabled={!valid} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  counter: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -Spacing.sm },
  multiline: { minHeight: 80 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
