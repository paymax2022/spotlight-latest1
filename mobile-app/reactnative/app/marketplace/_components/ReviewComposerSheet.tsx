// ── Marketplace — ReviewComposerSheet (Screen 26 Review Composer) ────────────
// Star rating + structured tags + optional free-text. Shown as a modal, opened
// manually after a user marks a deal complete in Meetup Mode. The review is
// OPTIONAL and self-reported — Skip is always allowed.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput } from 'react-native';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { MarketColors } from '@/features/marketplace';
import StarRating from './StarRating';
import { REVIEW_TAGS } from './transact.constants';

export default function ReviewComposerSheet({
  visible,
  submitting,
  onSkip,
  onSubmit,
}: {
  visible: boolean;
  submitting?: boolean;
  onSkip: () => void;
  onSubmit: (input: { rating: number; tags: string[]; text?: string }) => void;
}) {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');

  const toggleTag = (t: string) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onSkip}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Rate this deal</Text>
            <Pressable onPress={onSkip} hitSlop={10}>
              <X size={22} color={MarketColors.muted} />
            </Pressable>
          </View>
          <Text style={styles.sub}>Your review is the trust backbone of the marketplace — it helps the next buyer.</Text>

          <View style={styles.starWrap}>
            <StarRating value={rating} onChange={setRating} />
          </View>

          <Text style={styles.label}>What went well?</Text>
          <View style={styles.tagRow}>
            {REVIEW_TAGS.map((t) => {
              const active = tags.includes(t);
              return (
                <Pressable key={t} onPress={() => toggleTag(t)} style={[styles.tag, active && styles.tagActive]}>
                  <Text style={[styles.tagText, active && styles.tagTextActive]}>{t}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Add a note (optional)…"
            placeholderTextColor={MarketColors.muted}
            multiline
            maxLength={500}
          />

          <PrimaryButton
            label="Submit review"
            onPress={() => onSubmit({ rating, tags, text: text.trim() || undefined })}
            disabled={rating === 0 || submitting}
            loading={submitting}
            style={{ marginTop: Spacing.md }}
          />
          <Pressable onPress={onSkip} style={styles.skip}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.titleLg, color: MarketColors.text },
  sub: { ...Typography.bodySm, color: MarketColors.muted, marginTop: Spacing.xs, lineHeight: 18 },
  starWrap: { alignItems: 'center', paddingVertical: Spacing.lg },
  label: { ...Typography.labelMd, color: MarketColors.muted, fontWeight: '600', marginBottom: Spacing.sm },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tag: { borderRadius: Radius.full, borderWidth: 1.5, borderColor: MarketColors.border, paddingHorizontal: Spacing.md, paddingVertical: 7 },
  tagActive: { borderColor: MarketColors.brand, backgroundColor: MarketColors.warnBg },
  tagText: { ...Typography.labelMd, color: MarketColors.text },
  tagTextActive: { color: MarketColors.brand, fontWeight: '700' },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: MarketColors.border, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 72, textAlignVertical: 'top', backgroundColor: MarketColors.surface, marginTop: Spacing.md },
  skip: { alignItems: 'center', paddingVertical: Spacing.sm, marginTop: Spacing.xs },
  skipText: { ...Typography.labelMd, color: MarketColors.muted },
});
