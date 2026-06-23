// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { issueVisitorPass, listMyPasses } from '@/api/estate.api';
import type { VisitorPass } from '@/api/estate.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STATUS_COLOR: Record<string, string> = {
  active: '#00B894',
  used: '#6C5CE7',
  expired: '#94a3b8',
  revoked: '#dc2626',
};

const FILTER_OPTIONS = ['all', 'active', 'used', 'expired', 'revoked'] as const;
type Filter = (typeof FILTER_OPTIONS)[number];

function PassCard({ pass }: { pass: VisitorPass }) {
  const [showQR, setShowQR] = useState(false);
  const color = STATUS_COLOR[pass.status] ?? '#94a3b8';

  return (
    <View style={styles.passCard}>
      <View style={styles.passTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.passName}>{pass.visitor_name}</Text>
          {pass.purpose ? <Text style={styles.passPurpose}>{pass.purpose}</Text> : null}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
          <Text style={[styles.statusText, { color }]}>{pass.status}</Text>
        </View>
      </View>

      <View style={styles.passMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="time-outline" size={14} color={colors.neutral.textMuted} />
          <Text style={styles.metaText}>
            {new Date(pass.valid_from).toLocaleDateString()} –{' '}
            {new Date(pass.valid_until).toLocaleDateString()}
          </Text>
        </View>
        {pass.used_at && (
          <View style={styles.metaItem}>
            <Ionicons name="checkmark-circle-outline" size={14} color="#6C5CE7" />
            <Text style={styles.metaText}>
              Used {new Date(pass.used_at).toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      {/* QR toggle */}
      {pass.status === 'active' && (
        <Pressable style={styles.qrToggle} onPress={() => setShowQR((v) => !v)}>
          <Ionicons
            name={showQR ? 'eye-off-outline' : 'qr-code-outline'}
            size={16}
            color={colors.secondary.DEFAULT}
          />
          <Text style={styles.qrToggleText}>{showQR ? 'Hide QR' : 'Show QR'}</Text>
        </Pressable>
      )}

      {showQR && (
        <View style={styles.qrBox}>
          {/* Visual QR placeholder — in production swap for react-native-qrcode-svg */}
          <View style={styles.qrPlaceholder}>
            <Ionicons name="qr-code" size={80} color={colors.primary.DEFAULT} />
          </View>
          <Text style={styles.qrCode}>{pass.qr_code}</Text>
          <Text style={styles.qrHint}>Show this QR at the estate gate</Text>
        </View>
      )}
    </View>
  );
}

export default function PassesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [modal, setModal] = useState(false);
  const [visitorName, setVisitorName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });
  const estateId = activeContext.data?.estateId;

  const passes = useQuery({
    queryKey: ['estate-passes', estateId],
    queryFn: () => listMyPasses(estateId!),
    enabled: Boolean(estateId),
    retry: false,
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      issueVisitorPass(estateId!, {
        visitor_name: visitorName.trim(),
        purpose: purpose.trim() || undefined,
        valid_from: new Date(validFrom).toISOString(),
        valid_until: new Date(validUntil).toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estate-passes', estateId] });
      setSuccess(true);
      setTimeout(() => {
        setModal(false);
        setSuccess(false);
        setVisitorName('');
        setPurpose('');
        setValidFrom('');
        setValidUntil('');
      }, 1500);
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      setError(err?.response?.data?.error || 'Could not issue pass. Try again.'),
  });

  const filtered =
    filter === 'all' ? (passes.data ?? []) : (passes.data ?? []).filter((p) => p.status === filter);

  const validate = () => {
    if (!estateId) return 'Choose an estate before issuing a visitor pass';
    if (!visitorName.trim()) return 'Visitor name is required';
    if (!validFrom) return 'Valid-from date is required';
    if (!validUntil) return 'Valid-until date is required';
    if (new Date(validUntil) <= new Date(validFrom)) return 'Valid-until must be after valid-from';
    return null;
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Visitor Passes</Text>
        <Pressable
          style={styles.addBtn}
          onPress={() => {
            if (!estateId) {
              router.push('/estate/switcher' as never);
              return;
            }
            setModal(true);
            setError(null);
            setSuccess(false);
          }}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {FILTER_OPTIONS.map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {activeContext.isLoading || passes.isLoading ? (
        <AppLoader />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={passes.isRefetching} onRefresh={passes.refetch} />
          }
        >
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="qr-code-outline" size={56} color={colors.neutral.placeholder} />
              <Text style={styles.emptyTitle}>
                {estateId ? `No ${filter === 'all' ? '' : filter} passes` : 'Choose an estate first'}
              </Text>
              <Pressable
                style={styles.emptyAction}
                onPress={() => {
                  if (!estateId) {
                    router.push('/estate/switcher' as never);
                    return;
                  }
                  setModal(true);
                  setError(null);
                }}
              >
                <Text style={styles.emptyActionText}>
                  {estateId ? 'Issue a visitor pass' : 'Switch Estate'}
                </Text>
              </Pressable>
            </View>
          ) : (
            filtered.map((pass) => <PassCard key={pass.id} pass={pass} />)
          )}
        </ScrollView>
      )}

      {/* Issue Pass Modal */}
      <Modal visible={modal} transparent animationType="slide">
        <View style={styles.overlay}>
          <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 40 }}>
            {success ? (
              <View style={styles.successBox}>
                <Ionicons name="checkmark-circle" size={52} color="#00B894" />
                <Text style={styles.successTitle}>Pass Issued!</Text>
                <Text style={styles.successSub}>Share the QR with your visitor</Text>
              </View>
            ) : (
              <>
                <Text style={styles.sheetTitle}>Issue Visitor Pass</Text>

                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <Text style={styles.label}>Visitor Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. John Okafor"
                  placeholderTextColor={colors.neutral.placeholder}
                  value={visitorName}
                  onChangeText={setVisitorName}
                />

                <Text style={styles.label}>Purpose (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Family visit, Delivery"
                  placeholderTextColor={colors.neutral.placeholder}
                  value={purpose}
                  onChangeText={setPurpose}
                />

                <Text style={styles.label}>Valid From * (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2025-01-15"
                  placeholderTextColor={colors.neutral.placeholder}
                  value={validFrom}
                  onChangeText={setValidFrom}
                  keyboardType="numbers-and-punctuation"
                />

                <Text style={styles.label}>Valid Until * (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2025-01-15"
                  placeholderTextColor={colors.neutral.placeholder}
                  value={validUntil}
                  onChangeText={setValidUntil}
                  keyboardType="numbers-and-punctuation"
                />

                <Pressable
                  style={[styles.primaryBtn, issueMutation.isPending && styles.primaryBtnDisabled]}
                  disabled={issueMutation.isPending}
                  onPress={() => {
                    const err = validate();
                    if (err) { setError(err); return; }
                    setError(null);
                    issueMutation.mutate();
                  }}
                >
                  {issueMutation.isPending
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.primaryBtnText}>Issue Pass</Text>
                  }
                </Pressable>

                <Pressable
                  style={styles.cancelBtn}
                  onPress={() => { setModal(false); setError(null); }}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
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

  filterBar: { maxHeight: 52, backgroundColor: colors.neutral.surface },
  filterBarContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  filterChip: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
    backgroundColor: colors.neutral.surfaceAlt,
    borderWidth: 1, borderColor: colors.neutral.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.DEFAULT,
  },
  filterChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  filterChipTextActive: { color: '#fff' },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  passCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  passTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  passName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  passPurpose: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  passMeta: { gap: 4, marginBottom: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: colors.neutral.textMuted },

  qrToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.neutral.border,
  },
  qrToggleText: { fontSize: 13, fontWeight: '600', color: colors.secondary.DEFAULT },

  qrBox: { alignItems: 'center', paddingTop: 16, gap: 8 },
  qrPlaceholder: {
    width: 140, height: 140, backgroundColor: colors.neutral.surfaceAlt,
    borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.primary.DEFAULT + '30',
  },
  qrCode: { fontSize: 11, color: colors.neutral.textMuted, fontFamily: 'monospace' },
  qrHint: { fontSize: 12, color: colors.neutral.placeholder },

  emptyState: {
    alignItems: 'center', paddingVertical: 60, gap: 12,
  },
  emptyTitle: { fontSize: 16, color: colors.neutral.textMuted, fontWeight: '500' },
  emptyAction: {
    paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: colors.primary.DEFAULT, borderRadius: 20,
  },
  emptyActionText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.neutral.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '90%',
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
  successBox: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  successSub: { fontSize: 14, color: colors.neutral.textMuted },
});
