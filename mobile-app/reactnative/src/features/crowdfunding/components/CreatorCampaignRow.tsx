import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, ImageOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import CampaignStatusBadge from './CampaignStatusBadge';
import { formatNairaCompact, progressPct } from '../utils/crowdfundingFormatters';
import type { Campaign } from '../types/crowdfunding.types';

interface Props {
  campaign: Pick<Campaign, 'id' | 'title' | 'status' | 'paused' | 'coverImage' | 'raisedKobo' | 'goalKobo' | 'contributorCount'>;
  onPress: () => void;
}

/** Creator-side campaign row: cover + status + funding progress + manage chevron. */
export default function CreatorCampaignRow({ campaign, onPress }: Props) {
  const pct = progressPct(campaign.raisedKobo, campaign.goalKobo);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${campaign.title}, ${campaign.status.toLowerCase()}${campaign.paused ? ', paused' : ''}, ${pct}% funded`}
    >
      <View style={styles.thumb}>
        {campaign.coverImage ? <Image source={{ uri: campaign.coverImage }} style={styles.thumbImg} /> : <ImageOff size={18} color={Colors.outline} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{campaign.title}</Text>
        <View style={styles.badgeRow}>
          <CampaignStatusBadge status={campaign.status} paused={campaign.paused} size="sm" />
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
        <Text style={styles.meta}>
          {formatNairaCompact(campaign.raisedKobo)} of {formatNairaCompact(campaign.goalKobo)} · {campaign.contributorCount.toLocaleString('en-NG')} backers
        </Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.sm },
  thumb: { width: 60, height: 60, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  body: { flex: 1, gap: 5 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  badgeRow: { flexDirection: 'row' },
  track: { height: 5, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
