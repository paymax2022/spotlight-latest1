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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { contributeToGroup, createGroup, listMyGroups } from '@/api/groups.api';
import { colors } from '@/theme';
import { formatCurrency } from '@/utils/format';
import type { Group } from '@/types/fintech';

function GroupCard({ group, onContribute }: { group: Group; onContribute: (g: Group) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={[styles.groupIcon, { backgroundColor: '#6C5CE715' }]}>
          <Ionicons name="people" size={24} color="#6C5CE7" />
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardName}>{group.name}</Text>
          {group.is_private && (
            <View style={styles.privateBadge}>
              <Ionicons name="lock-closed" size={10} color={colors.neutral.textMuted} />
              <Text style={styles.privateBadgeText}>Private</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardDesc} numberOfLines={1}>{group.description}</Text>
        <View style={styles.cardMeta}>
          <Ionicons name="people-outline" size={12} color={colors.neutral.textMuted} />
          <Text style={styles.metaText}>{group.member_count} members</Text>
          {group.balance_kobo != null && (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaBalance}>{formatCurrency(group.balance_kobo, 'NGN')}</Text>
            </>
          )}
        </View>
      </View>
      <Pressable style={styles.contributeBtn} onPress={() => onContribute(group)}>
        <Ionicons name="add" size={16} color="#6C5CE7" />
      </Pressable>
    </View>
  );
}

function ContributeModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const [amountNaira, setAmountNaira] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => contributeToGroup({ group_id: group.id, amount_kobo: Math.round(parseFloat(amountNaira) * 100) }),
    onSuccess: () => setDone(true),
    onError: (err: any) => setError(err?.message || 'Contribution failed'),
  });

  if (done) {
    return (
      <View style={styles.modal}>
        <View style={styles.modalCard}>
          <Ionicons name="checkmark-circle" size={56} color="#6C5CE7" />
          <Text style={styles.modalSuccessTitle}>Contributed!</Text>
          <Text style={styles.modalSuccessSub}>Added to {group.name}</Text>
          <Pressable style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Done</Text>
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
        <Text style={styles.modalTitle}>Contribute to {group.name}</Text>
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
          style={[styles.modalBtn, mutation.isPending && { opacity: 0.6 }]}
          disabled={mutation.isPending}
          onPress={() => {
            setError(null);
            const amt = parseFloat(amountNaira);
            if (!amt || amt <= 0) { setError('Please enter a valid amount'); return; }
            mutation.mutate();
          }}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Contribute from Wallet</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function CreateGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [category, setCategory] = useState('savings');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createGroup({ name: name.trim(), description: description.trim(), is_private: isPrivate, category }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: any) => setError(err?.message || 'Failed to create group'),
  });

  return (
    <View style={styles.modal}>
      <View style={styles.modalCard}>
        <Pressable style={styles.modalClose} onPress={onClose}>
          <Ionicons name="close" size={22} color={colors.neutral.textMuted} />
        </Pressable>
        <Text style={styles.modalTitle}>Create a Group</Text>

        <TextInput
          style={styles.textField}
          placeholder="Group name"
          placeholderTextColor={colors.neutral.placeholder}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[styles.textField, { minHeight: 56 }]}
          placeholder="Description"
          placeholderTextColor={colors.neutral.placeholder}
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Private Group</Text>
          <Switch value={isPrivate} onValueChange={setIsPrivate} trackColor={{ true: '#6C5CE7' }} />
        </View>

        {error && <Text style={styles.modalError}>{error}</Text>}
        <Pressable
          style={[styles.modalBtn, mutation.isPending && { opacity: 0.6 }]}
          disabled={mutation.isPending}
          onPress={() => {
            setError(null);
            if (!name.trim()) { setError('Group name is required'); return; }
            mutation.mutate();
          }}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Create Group</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export default function GroupsScreen() {
  const router = useRouter();
  const [contributing, setContributing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useQuery({ queryKey: ['my-groups'], queryFn: listMyGroups });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Groups & Savings</Text>
        <Pressable style={styles.addBtn} onPress={() => setCreating(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />}
      >
        {query.isLoading ? null : (query.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color={colors.neutral.placeholder} />
            <Text style={styles.emptyTitle}>No Groups Yet</Text>
            <Text style={styles.emptyText}>Create or join a savings group</Text>
            <Pressable style={styles.createBtn} onPress={() => setCreating(true)}>
              <Text style={styles.createBtnText}>Create Group</Text>
            </Pressable>
          </View>
        ) : (
          (query.data ?? []).map((g) => (
            <GroupCard key={g.id} group={g} onContribute={setContributing} />
          ))
        )}
      </ScrollView>

      {contributing && <ContributeModal group={contributing} onClose={() => setContributing(null)} />}
      {creating && <CreateGroupModal onClose={() => setCreating(false)} onCreated={() => query.refetch()} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#6C5CE7',
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
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardLeft: {},
  groupIcon: {
    width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  privateBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.neutral.surfaceAlt, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  privateBadgeText: { fontSize: 10, color: colors.neutral.textMuted },
  cardDesc: { fontSize: 13, color: colors.neutral.textMuted, marginBottom: 6 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.neutral.textMuted },
  metaDot: { fontSize: 12, color: colors.neutral.placeholder },
  metaBalance: { fontSize: 12, fontWeight: '700', color: '#6C5CE7' },
  contributeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#6C5CE715', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#6C5CE730',
  },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  createBtn: { backgroundColor: '#6C5CE7', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 8 },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modal: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'flex-end', zIndex: 50 },
  modalCard: {
    backgroundColor: colors.neutral.surface, width: '100%',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14,
  },
  modalClose: { position: 'absolute', top: 16, right: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, paddingRight: 32 },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 2, borderColor: '#6C5CE7',
  },
  amountSymbol: { fontSize: 22, fontWeight: '800', color: colors.neutral.textMuted },
  amountInput: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.neutral.text },
  textField: {
    backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.neutral.border,
    fontSize: 14, color: colors.neutral.text,
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { fontSize: 15, color: colors.neutral.text, fontWeight: '500' },
  modalError: { fontSize: 13, color: '#dc2626' },
  modalBtn: { backgroundColor: '#6C5CE7', borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalSuccessTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  modalSuccessSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  doneBtn: { backgroundColor: '#6C5CE7', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
