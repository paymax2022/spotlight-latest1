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

import { listMyDisputes, openDispute } from '@/api/disputes.api';
import { colors } from '@/theme';
import type { Dispute } from '@/types/fintech';

const STATUS_COLOR: Record<string, { text: string; bg: string }> = {
  open: { text: '#dc2626', bg: '#FEE2E2' },
  investigating: { text: '#d97706', bg: '#FEF3C7' },
  resolved: { text: '#16a34a', bg: '#D1FAE5' },
  closed: { text: '#6b7280', bg: '#f3f4f6' },
};

const DISPUTE_TYPES = ['wrong_charge', 'failed_transaction', 'double_charge', 'service_not_received', 'other'];

export default function DisputesScreen() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [reference, setReference] = useState('');
  const [moduleType, setModuleType] = useState('wallet');
  const [type, setType] = useState('failed_transaction');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['my-disputes'], queryFn: listMyDisputes });

  const mutation = useMutation({
    mutationFn: () => openDispute({ reference: reference.trim(), module_type: moduleType, type, description: description.trim() }),
    onSuccess: () => {
      setShowForm(false);
      setReference(''); setDescription('');
      query.refetch();
    },
    onError: (err: any) => setError(err?.message || 'Submission failed.'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Disputes</Text>
        <Pressable style={styles.addBtn} onPress={() => setShowForm(!showForm)}>
          <Ionicons name={showForm ? 'close' : 'add'} size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />}
      >
        {/* New Dispute Form */}
        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Open a Dispute</Text>

            <Text style={styles.fieldLabel}>Transaction Reference</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.input}
                placeholder="e.g. TXN-XXXXXXXX"
                placeholderTextColor={colors.neutral.placeholder}
                value={reference}
                onChangeText={setReference}
              />
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Module</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {['wallet', 'restaurant', 'telemedicine', 'transport', 'events'].map((m) => (
                <Pressable
                  key={m}
                  style={[styles.chip, moduleType === m && styles.chipActive]}
                  onPress={() => setModuleType(m)}
                >
                  <Text style={[styles.chipText, moduleType === m && styles.chipTextActive]}>{m}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Issue Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {DISPUTE_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[styles.chip, type === t && styles.chipActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                    {t.replace(/_/g, ' ')}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Description</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={[styles.input, { minHeight: 72 }]}
                placeholder="Describe what happened..."
                placeholderTextColor={colors.neutral.placeholder}
                value={description}
                onChangeText={setDescription}
                multiline
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submitBtn, mutation.isPending && styles.submitBtnDisabled]}
              disabled={mutation.isPending}
              onPress={() => {
                setError(null);
                if (!reference.trim()) { setError('Please enter the transaction reference'); return; }
                if (!description.trim()) { setError('Please describe the issue'); return; }
                mutation.mutate();
              }}
            >
              {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Dispute</Text>}
            </Pressable>
          </View>
        )}

        {/* Dispute List */}
        {query.isLoading ? null : (query.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="flag-outline" size={48} color={colors.neutral.placeholder} />
            <Text style={styles.emptyTitle}>No Disputes</Text>
            <Text style={styles.emptyText}>You haven't raised any disputes yet.</Text>
          </View>
        ) : (
          (query.data ?? []).map((d: Dispute) => {
            const s = STATUS_COLOR[d.status] ?? STATUS_COLOR.closed;
            return (
              <View key={d.id} style={styles.disputeCard}>
                <View style={styles.disputeHeader}>
                  <Text style={styles.disputeRef} numberOfLines={1}>{d.reference}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                    <Text style={[styles.statusText, { color: s.text }]}>{d.status}</Text>
                  </View>
                </View>
                <Text style={styles.disputeType}>{d.type.replace(/_/g, ' ')} · {d.module_type}</Text>
                <Text style={styles.disputeDesc} numberOfLines={2}>{d.description}</Text>
                {d.resolution && (
                  <Text style={styles.disputeResolution}>Resolution: {d.resolution.replace(/_/g, ' ')}</Text>
                )}
                <Text style={styles.disputeDate}>{new Date(d.created_at).toLocaleDateString()}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#dc2626',
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
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  formCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, marginBottom: 8 },
  inputBox: {
    backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.neutral.border,
  },
  input: { fontSize: 14, color: colors.neutral.text },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: colors.neutral.surfaceAlt, borderWidth: 1, borderColor: colors.neutral.border,
  },
  chipActive: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  chipText: { fontSize: 13, color: colors.neutral.textMuted },
  chipTextActive: { color: '#fff' },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10, marginTop: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  submitBtn: {
    backgroundColor: '#dc2626', borderRadius: 12, height: 48,
    alignItems: 'center', justifyContent: 'center', marginTop: 14,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  disputeCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  disputeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  disputeRef: { fontSize: 14, fontWeight: '700', color: colors.neutral.text, flex: 1, marginRight: 8, fontFamily: 'monospace' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  disputeType: { fontSize: 12, color: colors.neutral.textMuted, marginBottom: 6, textTransform: 'capitalize' },
  disputeDesc: { fontSize: 13, color: colors.neutral.text, marginBottom: 8 },
  disputeResolution: { fontSize: 12, color: '#16a34a', fontWeight: '600', marginBottom: 4, textTransform: 'capitalize' },
  disputeDate: { fontSize: 11, color: colors.neutral.placeholder },
});
