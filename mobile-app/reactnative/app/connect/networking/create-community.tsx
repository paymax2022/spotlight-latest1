import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import ToggleRow from '@/features/connect/components/ToggleRow';
import { useCreateCommunity } from '@/features/connect/networking/hooks';
import type { CreateCommunityInput } from '@/features/connect/networking/types';

const CATEGORIES = ['Fintech', 'Product', 'AI', 'Design', 'Career', 'Startups'];
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }));

/** Create a community (PRD §10.3 NW-07). */
export default function CreateCommunityScreen() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [isPrivate, setIsPrivate] = useState(false);

  const create = useCreateCommunity();

  const canSubmit = name.trim().length > 0 && description.trim().length > 0;

  function onCreate() {
    const input: CreateCommunityInput = {
      name: name.trim(),
      description: description.trim(),
      category,
      isPrivate,
    };
    create.mutate(input, {
      onSuccess: (created) => {
        router.replace(`/connect/networking/community-detail?id=${encodeURIComponent(created.id)}`);
      },
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New community" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Lagos Fintech Builders"
          maxLength={60}
        />
        <TextInputField
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What's this community about?"
          multiline
          numberOfLines={4}
          maxLength={300}
          style={styles.multiline}
        />

        <Text style={styles.label}>Category</Text>
        <SegmentedControl scrollable options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />

        <View style={styles.toggleWrap}>
          <ToggleRow
            label="Private community"
            sub="Members must be approved to join"
            value={isPrivate}
            onValueChange={setIsPrivate}
          />
        </View>

        {create.isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Couldn't create the community. Please try again.</Text>
          </View>
        ) : null}

        <View style={{ height: Spacing.lg }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Create community"
          onPress={onCreate}
          loading={create.isPending}
          disabled={!canSubmit}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  toggleWrap: { marginTop: Spacing.md },
  errorBox: {
    backgroundColor: Colors.errorContainer,
    borderRadius: 12,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  errorText: { ...Typography.labelMd, color: Colors.error },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
