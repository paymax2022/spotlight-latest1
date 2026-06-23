// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createEstate, listElections, listMyPasses } from '@/api/estate.api';
import { AppLoader } from '@/components/ui/AppLoader';
import {
  getActiveEstateContext,
  setActiveEstate,
} from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STATUS_COLOR: Record<string, string> = {
  active: '#00B894',
  used: '#6C5CE7',
  expired: '#94a3b8',
  revoked: '#dc2626',
};

const ELECTION_COLOR: Record<string, string> = {
  draft: '#94a3b8',
  open: '#00B894',
  closed: '#F39C12',
  tallied: '#6C5CE7',
};

export default function EstateScreen() {
  const router = useRouter();
  const [createModal, setCreateModal] = useState(false);
  const [estateName, setEstateName] = useState('');
  const [estateAddress, setEstateAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });
  const estateId = activeContext.data?.estateId;
  const estateLabel = activeContext.data?.estateName ?? 'No estate selected';

  const passes = useQuery({
    queryKey: ['estate-passes', estateId],
    queryFn: () => listMyPasses(estateId!),
    enabled: Boolean(estateId),
    retry: false,
  });

  const elections = useQuery({
    queryKey: ['estate-elections', estateId],
    queryFn: () => listElections(estateId!),
    enabled: Boolean(estateId),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createEstate({ name: estateName.trim(), address: estateAddress.trim() || undefined }),
    onSuccess: async (estate) => {
      await setActiveEstate(estate.id, estate.name);
      setCreateModal(false);
      setEstateName('');
      setEstateAddress('');
      activeContext.refetch();
      passes.refetch();
      elections.refetch();
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      setError(err?.response?.data?.error || 'Failed to create estate'),
  });

  const activePasses = estateId ? passes.data?.filter((p) => p.status === 'active') ?? [] : [];
  const openElections = estateId ? elections.data?.filter((e) => e.status === 'open') ?? [] : [];

  if (activeContext.isLoading) return <AppLoader />;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Estate Management</Text>
        <Pressable style={styles.addBtn} onPress={() => setCreateModal(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Banner */}
        <View style={styles.banner}>
          <View style={styles.bannerGlow} />
          <Ionicons name="home" size={36} color="#fff" style={{ marginBottom: 8 }} />
          <Text style={styles.bannerTitle}>Your Estate Hub</Text>
          <Text style={styles.bannerSub}>{estateLabel}</Text>
        </View>

        {!estateId && (
          <View style={styles.emptyCard}>
            <Ionicons name="trail-sign-outline" size={32} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>Choose or join an estate to continue</Text>
            <View style={styles.emptyActionsRow}>
              <Pressable
                style={styles.emptyAction}
                onPress={() => router.push('/estate/switcher' as never)}
              >
                <Text style={styles.emptyActionText}>Switch Estate</Text>
              </Pressable>
              <Pressable
                style={styles.emptyAction}
                onPress={() => router.push('/estate/join' as never)}
              >
                <Text style={styles.emptyActionText}>Join Estate</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickRow}>
          <Pressable
            style={styles.quickCard}
            onPress={() =>
              estateId ? router.push('/estate/passes' as never) : router.push('/estate/switcher' as never)
            }
          >
            <View style={[styles.quickIcon, { backgroundColor: '#00B89420' }]}>
              <Ionicons name="qr-code-outline" size={26} color="#00B894" />
            </View>
            <Text style={styles.quickLabel}>Visitor Passes</Text>
            <Text style={styles.quickCount}>{activePasses.length} active</Text>
          </Pressable>

          <Pressable
            style={styles.quickCard}
            onPress={() =>
              estateId ? router.push('/estate/elections' as never) : router.push('/estate/switcher' as never)
            }
          >
            <View style={[styles.quickIcon, { backgroundColor: '#6C5CE720' }]}>
              <Ionicons name="podium-outline" size={26} color="#6C5CE7" />
            </View>
            <Text style={styles.quickLabel}>Elections</Text>
            <Text style={styles.quickCount}>{openElections.length} open</Text>
          </Pressable>
        </View>

        {/* Secondary Actions */}
        <View style={styles.quickRow}>
          <Pressable
            style={styles.quickCard}
            onPress={() => router.push('/estate/properties' as never)}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#10B98120' }]}>
              <Ionicons name="home-outline" size={26} color="#10B981" />
            </View>
            <Text style={styles.quickLabel}>Properties</Text>
            <Text style={styles.quickCount}>View units</Text>
          </Pressable>

          <Pressable
            style={styles.quickCard}
            onPress={() => router.push('/estate/switcher' as never)}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="swap-horizontal-outline" size={26} color="#F59E0B" />
            </View>
            <Text style={styles.quickLabel}>Switch Estate</Text>
            <Text style={styles.quickCount}>Change estate</Text>
          </Pressable>

          <Pressable
            style={styles.quickCard}
            onPress={() => router.push('/estate/profile' as never)}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#6C63FF20' }]}>
              <Ionicons name="person-circle-outline" size={26} color="#6C63FF" />
            </View>
            <Text style={styles.quickLabel}>My Profile</Text>
            <Text style={styles.quickCount}>Resident card</Text>
          </Pressable>

          <Pressable
            style={styles.quickCard}
            onPress={() => router.push('/estate/dashboard' as never)}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#06B6D420' }]}>
              <Ionicons name="grid-outline" size={26} color="#06B6D4" />
            </View>
            <Text style={styles.quickLabel}>Dashboard</Text>
            <Text style={styles.quickCount}>Overview</Text>
          </Pressable>
        </View>

        {/* Active Passes Preview */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Active Visitor Passes</Text>
            <Pressable onPress={() => router.push('/estate/passes' as never)}>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>

          {passes.isLoading ? (
            <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginVertical: 16 }} />
          ) : activePasses.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="qr-code-outline" size={32} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No active passes</Text>
              <Pressable
                style={styles.emptyAction}
                onPress={() => router.push('/estate/passes' as never)}
              >
                <Text style={styles.emptyActionText}>Issue a pass</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              {activePasses.slice(0, 3).map((pass, idx) => (
                <View
                  key={pass.id}
                  style={[styles.listRow, idx < activePasses.length - 1 && styles.listBorder]}
                >
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[pass.status] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>{pass.visitor_name}</Text>
                    <Text style={styles.listSub}>
                      Expires {new Date(pass.valid_until).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: STATUS_COLOR[pass.status] + '20' }]}>
                    <Text style={[styles.badgeText, { color: STATUS_COLOR[pass.status] }]}>
                      {pass.status}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Open Elections Preview */}
        <View style={[styles.section, { marginBottom: 32 }]}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Open Elections</Text>
            <Pressable onPress={() => router.push('/estate/elections' as never)}>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>

          {elections.isLoading ? (
            <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginVertical: 16 }} />
          ) : openElections.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="podium-outline" size={32} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No open elections</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {openElections.map((el, idx) => (
                <Pressable
                  key={el.id}
                  style={[styles.listRow, idx < openElections.length - 1 && styles.listBorder]}
                  onPress={() => router.push('/estate/elections' as never)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>{el.title}</Text>
                    <Text style={styles.listSub}>
                      Ends {new Date(el.ends_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: ELECTION_COLOR[el.status] + '20' }]}>
                    <Text style={[styles.badgeText, { color: ELECTION_COLOR[el.status] }]}>
                      {el.status}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Create Estate Modal */}
      <Modal visible={createModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Create Estate</Text>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.label}>Estate Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Lekki Gardens Phase 2"
              placeholderTextColor={colors.neutral.placeholder}
              value={estateName}
              onChangeText={setEstateName}
            />

            <Text style={styles.label}>Address (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 12 Palm Avenue, Lekki"
              placeholderTextColor={colors.neutral.placeholder}
              value={estateAddress}
              onChangeText={setEstateAddress}
            />

            <Pressable
              style={[styles.primaryBtn, createMutation.isPending && styles.primaryBtnDisabled]}
              disabled={createMutation.isPending}
              onPress={() => {
                setError(null);
                if (!estateName.trim()) { setError('Estate name is required'); return; }
                createMutation.mutate();
              }}
            >
              {createMutation.isPending
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Create Estate</Text>
              }
            </Pressable>

            <Pressable style={styles.cancelBtn} onPress={() => { setCreateModal(false); setError(null); }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  addBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },

  content: { padding: 20, gap: 20 },

  banner: {
    borderRadius: 20, padding: 24, backgroundColor: colors.primary.dark,
    alignItems: 'center', overflow: 'hidden',
  },
  bannerGlow: {
    position: 'absolute', top: -30, right: -30, width: 120, height: 120,
    borderRadius: 60, backgroundColor: colors.secondary.DEFAULT, opacity: 0.25,
  },
  bannerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center' },

  quickRow: { flexDirection: 'row', gap: 12 },
  quickCard: {
    flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16,
    alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  quickIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 13, fontWeight: '700', color: colors.neutral.text },
  quickCount: { fontSize: 12, color: colors.neutral.textMuted },

  section: {},
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  seeAll: { fontSize: 13, color: colors.secondary.DEFAULT, fontWeight: '600' },

  card: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  emptyCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 28,
    alignItems: 'center', gap: 8,
  },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  emptyAction: {
    marginTop: 4, paddingHorizontal: 20, paddingVertical: 8,
    backgroundColor: colors.primary.DEFAULT + '15', borderRadius: 20,
  },
  emptyActionText: { fontSize: 13, fontWeight: '600', color: colors.primary.DEFAULT },
  emptyActionsRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.neutral.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginBottom: 6 },
  input: {
    backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 14,
    fontSize: 15, color: colors.neutral.text, marginBottom: 14,
    borderWidth: 1, borderColor: colors.neutral.border,
  },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText: { color: '#dc2626', fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 12 },
  cancelBtnText: { color: colors.neutral.textMuted, fontSize: 15, fontWeight: '600' },
});
