import React, { useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, Image, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow3 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import VoteCounter from './VoteCounter';
import VotePackageCard from './VotePackageCard';
import FreeVoteBadge from './FreeVoteBadge';
import type { Contestant, VotePackage, FreeVoteAllocation } from '../types/voting.types';
import FreeVoteResetCountdown from './FreeVoteResetCountdown';
import { formatAmount } from '../utils/voteFormatters';

type Tab = 'free' | 'paid';

interface Props {
  visible: boolean;
  onClose: () => void;
  contestant: Contestant;
  freeVotes: FreeVoteAllocation;
  packages: VotePackage[];
  onConfirmFree: (votes: number) => void;
  onConfirmPaid: (pkg: VotePackage, votes: number) => void;
  isFreeLoading?: boolean;
}

export default function VoteConfirmationSheet({
  visible, onClose, contestant, freeVotes, packages, onConfirmFree, onConfirmPaid, isFreeLoading,
}: Props) {
  const [tab, setTab] = useState<Tab>('free');
  const [freeCount, setFreeCount] = useState(Math.min(freeVotes.remaining, 1));
  const [selectedPkg, setSelectedPkg] = useState<VotePackage | null>(packages[0] ?? null);

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, shadow3]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={styles.contestantInfo}>
              {contestant.photo ? (
                <Image source={{ uri: contestant.photo }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{contestant.name.charAt(0)}</Text>
                </View>
              )}
              <View>
                <Text style={styles.contestantName}>{contestant.stageName ?? contestant.name}</Text>
                <Text style={styles.rank}>Current Rank #{contestant.rank}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={styles.tabs}>
            <Pressable
              onPress={() => setTab('free')}
              style={[styles.tab, tab === 'free' && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, tab === 'free' && styles.tabLabelActive]}>Free Vote</Text>
            </Pressable>
            <Pressable
              onPress={() => setTab('paid')}
              style={[styles.tab, tab === 'paid' && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, tab === 'paid' && styles.tabLabelActive]}>Paid Vote</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {tab === 'free' ? (
              <View style={styles.freeTab}>
                <FreeVoteBadge remaining={freeVotes.remaining} total={freeVotes.total} />
                {freeVotes.remaining === 0 ? (
                  <View style={styles.exhausted}>
                    <Text style={styles.exhaustedTitle}>No free votes left for this contestant today</Text>
                    <Text style={styles.exhaustedSub}>You’ve used your {freeVotes.total} daily free votes for {contestant.stageName ?? contestant.name}. They’ll be active again in:</Text>
                    <View style={{ marginTop: 10, alignItems: 'center' }}>
                      <FreeVoteResetCountdown resetAt={freeVotes.resetsAt} />
                    </View>
                    <Text style={[styles.exhaustedSub, { marginTop: 10 }]}>Switch to paid votes to keep supporting them now.</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.chooseLabel}>Choose how many votes to cast:</Text>
                    <VoteCounter
                      value={freeCount}
                      onChange={setFreeCount}
                      min={1}
                      max={freeVotes.remaining}
                    />
                    <PrimaryButton
                      label={isFreeLoading ? 'Casting votes…' : `Cast ${freeCount} Free ${freeCount === 1 ? 'Vote' : 'Votes'}`}
                      onPress={() => onConfirmFree(freeCount)}
                      loading={isFreeLoading}
                      disabled={freeCount < 1 || freeVotes.remaining === 0}
                    />
                  </>
                )}
              </View>
            ) : (
              <View style={styles.paidTab}>
                <Text style={styles.chooseLabel}>Select a vote package:</Text>
                <View style={styles.packagesGrid}>
                  {packages.map((pkg) => (
                    <View key={pkg.id} style={styles.packageItem}>
                      <VotePackageCard
                        pkg={pkg}
                        selected={selectedPkg?.id === pkg.id}
                        onPress={() => setSelectedPkg(pkg)}
                      />
                    </View>
                  ))}
                </View>
                {selectedPkg && (
                  <View style={styles.summary}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Votes</Text>
                      <Text style={styles.summaryValue}>{selectedPkg.votes + (selectedPkg.bonusVotes ?? 0)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Amount</Text>
                      <Text style={[styles.summaryValue, { color: Colors.primary }]}>{formatAmount(selectedPkg.amount)}</Text>
                    </View>
                  </View>
                )}
                <PrimaryButton
                  label={selectedPkg ? `Pay ${formatAmount(selectedPkg.amount)} · Continue` : 'Select a package'}
                  onPress={() => selectedPkg && onConfirmPaid(selectedPkg, selectedPkg.votes + (selectedPkg.bonusVotes ?? 0))}
                  disabled={!selectedPkg}
                />
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:     { flex: 1, justifyContent: 'flex-end' },
  backdrop:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius:  Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight:            '90%',
    paddingBottom:        Platform.OS === 'ios' ? 34 : 24,
  },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  contestantInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar:      { width: 44, height: 44, borderRadius: Radius.full },
  avatarPlaceholder: { backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.labelLg, color: Colors.onPrimaryContainer },
  contestantName: { ...Typography.labelLg, color: Colors.onSurface },
  rank:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  closeBtn:    { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  tabs:        { flexDirection: 'row', marginHorizontal: Spacing.lg, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: 4, marginBottom: Spacing.md },
  tab:         { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.DEFAULT },
  tabActive:   { backgroundColor: Colors.primary },
  tabLabel:    { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tabLabelActive: { color: Colors.onPrimary },
  content:     { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  freeTab:     { gap: Spacing.lg, alignItems: 'center' },
  paidTab:     { gap: Spacing.md },
  chooseLabel: { ...Typography.labelMd, color: Colors.onSurface, alignSelf: 'flex-start' },
  exhausted:   { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  exhaustedTitle: { ...Typography.titleMd, color: Colors.onSurface },
  exhaustedSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  packagesGrid: { gap: Spacing.sm },
  packageItem:  {},
  summary:      { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
});
