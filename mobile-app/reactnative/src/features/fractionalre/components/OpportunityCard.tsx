import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Heart, MapPin } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { KIND_LABEL } from '../constants';
import { formatNaira, formatYield, tenorLabel } from '../utils';
import RiskBandPill from './RiskBandPill';
import TitleVerifiedBadge from './TitleVerifiedBadge';
import FundingProgressBar from './FundingProgressBar';
import OfferCountdown from './OfferCountdown';
import type { OfferingSummary } from '../types';

interface Props {
  offering: OfferingSummary;
  onToggleWatch?: (o: OfferingSummary) => void;
}

export default function OpportunityCard({ offering, onToggleWatch }: Props) {
  return (
    <Pressable style={styles.card} onPress={() => router.push(`/fractionalre/${offering.id}` as never)}>
      <View>
        <Image source={{ uri: offering.coverImageUrl }} style={styles.image} />
        <View style={styles.imageOverlay}>
          <View style={styles.kindChip}><Text style={styles.kindText}>{KIND_LABEL[offering.kind]}</Text></View>
          {onToggleWatch ? (
            <Pressable
              hitSlop={8}
              onPress={(e) => { e.stopPropagation?.(); onToggleWatch(offering); }}
              style={styles.heartBtn}
              accessibilityLabel={offering.watched ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <Heart size={18} color={offering.watched ? Colors.error : Colors.onPrimary}
                fill={offering.watched ? Colors.error : 'transparent'} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{offering.title}</Text>
        <View style={styles.locRow}>
          <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.loc} numberOfLines={1}>{offering.location}</Text>
        </View>

        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metricVal}>{formatYield(offering.projectedYieldBps)}</Text>
            <Text style={styles.metricLabel}>Proj. yield</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricVal}>{tenorLabel(offering.tenorMonths)}</Text>
            <Text style={styles.metricLabel}>Tenor</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricVal}>{formatNaira(offering.unitPriceKobo)}</Text>
            <Text style={styles.metricLabel}>Per unit</Text>
          </View>
        </View>

        <FundingProgressBar raisedKobo={offering.raisedKobo} targetKobo={offering.targetKobo} />

        <View style={styles.footer}>
          <View style={styles.badges}>
            <RiskBandPill band={offering.riskBand} small />
            <TitleVerifiedBadge verified={offering.titleVerified} small />
          </View>
          <OfferCountdown closesAt={offering.closesAt} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  image: { width: '100%', height: 150, backgroundColor: Colors.surfaceContainerHigh },
  imageOverlay: {
    position: 'absolute', top: Spacing.sm, left: Spacing.sm, right: Spacing.sm,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  kindChip: { backgroundColor: 'rgba(11,28,48,0.7)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  kindText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '600' },
  heartBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(11,28,48,0.5)', alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.md, gap: Spacing.sm },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  metrics: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  metric: { alignItems: 'flex-start' },
  metricVal: { ...Typography.labelLg, color: Colors.onSurface },
  metricLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
});
