// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { backCampaign, listCampaigns } from '@/api/crowdfunding.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';
import type { Campaign } from '@/types/fintech';

function ProgressBar({ raised, goal }: { raised: number; goal: number }) {
  const pct = Math.min(100, goal > 0 ? (raised / goal) * 100 : 0);
  return (
    <View style={styles.progressBar}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
    </View>
  );
}

function CampaignCard({ campaign, onBack }: { campaign: Campaign; onBack: (c: Campaign) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardImage}>
        <Ionicons name="heart" size={36} color="rgba(232,67,147,0.5)" />
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{campaign.category}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{campaign.title}</Text>
        <Text style={styles.cardCreator}>by {campaign.creator_name}</Text>
        <Text style={styles.cardDesc} numberOfLines={2}>{campaign.description}</Text>
        <ProgressBar raised={campaign.raised_kobo} goal={campaign.goal_kobo} />
        <View style={styles.statsRow}>
          <Text style={styles.raised}>{formatCurrency(campaign.raised_kobo, 'NGN')} raised</Text>
          <Text style={styles.goal}>of {formatCurrency(campaign.goal_kobo, 'NGN')}</Text>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={14} color={colors.neutral.textMuted} />
            <Text style={styles.metaText}>{campaign.backer_count} backers</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={14} color={colors.neutral.textMuted} />
            <Text style={styles.metaText}>{campaign.days_left}d left</Text>
          </View>
          <Pressable style={styles.backBtn} onPress={() => onBack(campaign)}>
            <Text style={styles.backBtnText}>Back This</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function BackModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [amountNaira, setAmountNaira] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => backCampaign({
      campaign_id: campaign.id,
      amount_kobo: Math.round(parseFloat(amountNaira) * 100),
    }),
    onSuccess: () => setDone(true),
    onError: (err: any) => setError(err?.message || 'Contribution failed'),
  });

  if (done) {
    return (
      <View style={styles.modal}>
        <View style={styles.modalCard}>
          <Ionicons name="heart-circle" size={56} color="#E84393" />
          <Text style={styles.modalSuccessTitle}>Thank you!</Text>
          <Text style={styles.modalSuccessSub}>You've backed "{campaign.title}"</Text>
          <Pressable style={styles.modalDoneBtn} onPress={onClose}>
            <Text style={styles.modalDoneBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.modal}>
      <View style={styles.modalCard}>
        <Pressable style={styles.modalClose} onPress={onClose}>
          <Ionicons name="close" size={22} color={colors.neutral.textMuted} />
        </Pressable>
        <Text style={styles.modalTitle} numberOfLines={2}>{campaign.title}</Text>
        <Text style={styles.modalSub}>How much would you like to contribute?</Text>
        <View style={styles.amountBox}>
          <Text style={styles.amountSymbol}>₦</Text>
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor={colors.neutral.placeholder}
            value={amountNaira}
            onChangeText={setAmountNaira}
            keyboardType="decimal-pad"
            autoFocus
          />
        </View>
        {error && <Text style={styles.modalError}>{error}</Text>}
        <Pressable
          style={[styles.modalBackBtn, mutation.isPending && { opacity: 0.6 }]}
          disabled={mutation.isPending}
          onPress={() => {
            setError(null);
            const amt = parseFloat(amountNaira);
            if (!amt || amt <= 0) { setError('Please enter a valid amount'); return; }
            mutation.mutate();
          }}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBackBtnText}>Contribute from Wallet</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export default function CrowdfundingScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Campaign | null>(null);

  const query = useQuery({ queryKey: ['campaigns', search], queryFn: () => listCampaigns({ search }) });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn2} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Crowdfunding</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={colors.neutral.placeholder} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search campaigns..."
            placeholderTextColor={colors.neutral.placeholder}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {query.isLoading ? (
        <AppLoader />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />}
        >
          {(query.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="heart-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No campaigns found</Text>
            </View>
          ) : (
            (query.data ?? []).map((c) => (
              <CampaignCard key={c.id} campaign={c} onBack={setSelected} />
            ))
          )}
        </ScrollView>
      )}

      {selected && <BackModal campaign={selected} onClose={() => setSelected(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#E84393',
  },
  backBtn2: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 12 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.neutral.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.neutral.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.neutral.text },
  list: { padding: 16, gap: 16 },
  card: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  cardImage: {
    height: 110, backgroundColor: '#fce4ec',
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  categoryBadge: {
    position: 'absolute', top: 10, left: 10,
    backgroundColor: 'rgba(232,67,147,0.85)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  categoryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardBody: { padding: 14, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  cardCreator: { fontSize: 12, color: '#E84393', fontWeight: '600' },
  cardDesc: { fontSize: 13, color: colors.neutral.textMuted },
  progressBar: { height: 6, backgroundColor: colors.neutral.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#E84393', borderRadius: 3 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  raised: { fontSize: 14, fontWeight: '700', color: '#E84393' },
  goal: { fontSize: 13, color: colors.neutral.textMuted },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.neutral.textMuted },
  backBtn: {
    marginLeft: 'auto', backgroundColor: '#E84393', paddingHorizontal: 14,
    paddingVertical: 7, borderRadius: 20,
  },
  backBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  modal: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'flex-end', zIndex: 50 },
  modalCard: {
    backgroundColor: colors.neutral.surface, width: '100%',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14,
  },
  modalClose: { position: 'absolute', top: 16, right: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, paddingRight: 32 },
  modalSub: { fontSize: 14, color: colors.neutral.textMuted },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 2, borderColor: '#E84393',
  },
  amountSymbol: { fontSize: 22, fontWeight: '800', color: colors.neutral.textMuted },
  amountInput: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.neutral.text },
  modalError: { fontSize: 13, color: '#dc2626' },
  modalBackBtn: {
    backgroundColor: '#E84393', borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center',
  },
  modalBackBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalSuccessTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  modalSuccessSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  modalDoneBtn: { backgroundColor: '#E84393', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  modalDoneBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
