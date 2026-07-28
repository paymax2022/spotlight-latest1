import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Hash, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useCreatePost } from '@/features/connect/networking/content/hooks';

const MAX_BODY = 3000;

// Parse "#tag" tokens from the body so hashtags stay in sync with the text.
function extractHashtags(text: string): string[] {
  const found = text.match(/#(\w{2,40})/g) ?? [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of found) {
    const tag = raw.slice(1);
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Compose post (PRD §6.2 CN-01). Text + hashtags (mock-first).
 * POST /networking/posts requires an Idempotency-Key (added in the API layer).
 */
export default function ComposePostScreen() {
  const [body, setBody] = useState('');
  const create = useCreatePost();

  const hashtags = useMemo(() => extractHashtags(body), [body]);
  const canPost = body.trim().length > 0 && !create.isPending;

  function onPost() {
    create.mutate(
      { body: body.trim(), hashtags, mediaRefs: [] },
      {
        onSuccess: (post) => {
          router.replace(`/connect/networking/content/${encodeURIComponent(post.id)}`);
        },
      },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New post" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <TextInputField
          label="What do you want to share?"
          value={body}
          onChangeText={setBody}
          placeholder="Share an update, a win, or a lesson… use #hashtags to reach a topic"
          multiline
          numberOfLines={8}
          maxLength={MAX_BODY}
          style={styles.bodyInput}
        />
        <Text style={styles.counter}>
          {body.trim().length}/{MAX_BODY}
        </Text>

        {hashtags.length ? (
          <View style={styles.tagsBlock}>
            <View style={styles.tagsHeader}>
              <Hash size={15} color={ConnectColors.brand} strokeWidth={2.4} />
              <Text style={styles.tagsTitle}>Topics</Text>
            </View>
            <DiscoveryChipRow items={hashtags} variant="static" />
          </View>
        ) : null}

        <View style={styles.note}>
          <ShieldCheck size={16} color={ConnectColors.ok} strokeWidth={2} />
          <Text style={styles.noteText}>
            Posts are ranked by verified outcomes, not just likes — genuine contributions travel further.
          </Text>
        </View>

        {create.isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Couldn't publish your post. Please try again.</Text>
          </View>
        ) : null}

        <View style={{ height: Spacing.xl }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Post" onPress={onPost} loading={create.isPending} disabled={!canPost} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  bodyInput: { minHeight: 150, textAlignVertical: 'top' },
  counter: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'right', marginTop: -Spacing.sm },
  tagsBlock: { marginTop: Spacing.md, gap: Spacing.sm },
  tagsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagsTitle: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  note: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.lg,
  },
  noteText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  errorBox: {
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
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
