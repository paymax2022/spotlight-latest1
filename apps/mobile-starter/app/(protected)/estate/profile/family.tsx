// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addHouseholdMember, deleteHouseholdMember, listHouseholdMembers } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

export default function FamilyScreen() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [dob, setDob] = useState('');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['household-members'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listHouseholdMembers(ctx.estateId);
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return addHouseholdMember(ctx.estateId, { full_name: fullName, relationship, dob: dob || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['household-members'] });
      setModal(false);
      setFullName(''); setRelationship(''); setDob('');
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Failed to add member'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return deleteHouseholdMember(ctx.estateId, memberId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['household-members'] }),
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Failed to remove member'),
  });

  function confirmDelete(id: string, name: string) {
    Alert.alert('Remove', `Remove ${name} from household?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.heading}>Household Members</Text>
            <Pressable style={styles.addBtn} onPress={() => setModal(true)}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
            : <View style={styles.empty}><Text style={styles.emptyText}>No household members registered yet.</Text></View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={22} color={colors.primary.DEFAULT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.full_name}</Text>
              <Text style={styles.rel}>{item.relationship}{item.dob ? ` · DOB: ${item.dob}` : ''}</Text>
            </View>
            <Pressable onPress={() => confirmDelete(item.id, item.full_name)} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
            </Pressable>
          </View>
        )}
      />

      <Modal visible={modal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add Household Member</Text>
            <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Full name *" placeholderTextColor={colors.neutral.placeholder} />
            <Text style={styles.chipLabel}>Relationship</Text>
            <View style={styles.chipRow}>
              {RELATIONSHIPS.map((r) => (
                <Pressable key={r} style={[styles.chip, relationship === r && styles.chipActive]} onPress={() => setRelationship(r)}>
                  <Text style={[styles.chipText, relationship === r && styles.chipTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} value={dob} onChangeText={setDob} placeholder="Date of birth YYYY-MM-DD (optional)" placeholderTextColor={colors.neutral.placeholder} />
            <Pressable
              style={[styles.saveBtn, (!fullName || !relationship || addMutation.isPending) && styles.disabled]}
              onPress={() => addMutation.mutate()}
              disabled={!fullName || !relationship || addMutation.isPending}
            >
              {addMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Add Member</Text>}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  list: { padding: 20, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary.DEFAULT, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  rel: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, marginBottom: 4 },
  input: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  chipLabel: { fontSize: 12, fontWeight: '600', color: colors.neutral.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  chipTextActive: { color: '#fff' },
  saveBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontSize: 14, color: colors.neutral.textMuted },
});
