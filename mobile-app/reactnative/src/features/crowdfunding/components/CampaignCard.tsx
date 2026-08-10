import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Heart, Flame, Siren, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import CampaignProgress from './CampaignProgress';
import VerificationBadge from './VerificationBadge';
import type { CampaignSummary } from '../types/crowdfunding.types';

interface Props {
  campaign: CampaignSummary;
  onPress: () => void;
  onToggleSave?: (next: boolean) => void;
  variant?: 'full' | 'compact';   // compact = horizontal mini card for carousels
  style?: ViewStyle;
}

export default function CampaignCard({ campaign, onPress, onToggleSave, variant = 'full', style }: Props) {
  const isCompact = variant === 'compact';

  return (
    // Outer container is a plain View (renders as <div> on web) so the card button
    // and the save button below are SIBLINGS, never button-nested-in-button.
    <View style={[styles.wrap, isCompact && styles.cardCompact, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${campaign.title}. ${campaign.categoryLabel} campaign`}
        style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
      >
        <View style={[styles.imageWrap, isCompact && styles.imageWrapCompact]}>
          {campaign.coverImage ? (
            <Image source={{ uri: campaign.coverImage }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={styles.imagePlaceholder} />
          )}

          {/* Top-left flags */}
          <View style={styles.flagRow}>
            {campaign.urgent && (
              <View style={[styles.flag, styles.flagUrgent]}>
                <Siren size={11} color={Colors.onError} strokeWidth={2.2} />
                <Text style={styles.flagText}>Urgent</Text>
              </View>
            )}
            {campaign.trending && !campaign.urgent && (
              <View style={[styles.flag, styles.flagTrending]}>
                <Flame size={11} color={Colors.onPrimary} strokeWidth={2.2} />
                <Text style={styles.flagText}>Trending</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.metaRow}>
            <Text style={styles.category}>{campaign.categoryLabel}</Text>
            {campaign.verified && <VerificationBadge level="FULL" variant="icon" size={14} />}
          </View>

          <Text style={styles.title} numberOfLines={2}>{campaign.title}</Text>

          {!isCompact && (
            <Text style={styles.summary} numberOfLines={2}>{campaign.summary}</Text>
          )}

          <View style={styles.progressWrap}>
            <CampaignProgress
              raisedKobo={campaign.raisedKobo}
              goalKobo={campaign.goalKobo}
              contributorCount={campaign.contributorCount}
              deadline={campaign.deadline}
              compact
            />
          </View>

          <View style={styles.creatorRow}>
            <Text style={styles.creator} numberOfLines={1}>by {campaign.creatorName}</Text>
            {campaign.location && (
              <View style={styles.loc}>
                <MapPin size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.locText} numberOfLines={1}>{campaign.location}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>

      {/* Save button is a sibling overlay, not a descendant of the card button, so it
          stays a valid standalone <button> on web while still floating over the image. */}
      {onToggleSave && (
        <Pressable
          onPress={() => onToggleSave(!campaign.saved)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={campaign.saved ? 'Remove from saved' : 'Save campaign'}
          style={styles.saveBtn}
        >
          <Heart
            size={16}
            color={campaign.saved ? Colors.error : Colors.white}
            fill={campaign.saved ? Colors.error : 'transparent'}
            strokeWidth={2}
          />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Positioned container so the sibling save-button overlay anchors to the card bounds.
  wrap: { position: 'relative' },
  card: {
    width: '100%',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  cardCompact: { width: 280 },
  pressed: { opacity: 0.9 },
  imageWrap: { position: 'relative', height: 150 },
  imageWrapCompact: { height: 120 },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { width: '100%', height: '100%', backgroundColor: Colors.surfaceContainerHigh },
  flagRow: { position: 'absolute', top: Spacing.sm, left: Spacing.sm, flexDirection: 'row', gap: 6 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  flagUrgent: { backgroundColor: Colors.error },
  flagTrending: { backgroundColor: Colors.primary },
  flagText: { ...Typography.caption, color: Colors.white, fontWeight: '700' as const },
  saveBtn: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    width: 32, height: 32, borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  body: { padding: Spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  category: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: 4 },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  progressWrap: { marginTop: 4 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm, gap: Spacing.sm },
  creator: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flexShrink: 1 },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  locText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
