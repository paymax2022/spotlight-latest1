// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDomesticStaff, listDomesticStaff, updateStaffStatus } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const ROLES = ['Cook', 'Cleaner', 'Nanny', 'Driver', 'Security', 'Other'];
const STATUS_COLORS = { active: '#10B981', suspended: '#F59E0B', terminated: '#EF4444' };

export default function StaffScreen() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['domestic-staff'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listDomesticStaff(ctx.estateId);
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return addDomesticStaff(ctx.estateId, { full_name: fullName, role: role.toLowerCase(), phone: phone || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domestic-staff'] });
      setModal(false);
      setFullName(''); setRole(''); setPhone('');
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Failed to add staff'),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ staffId, status }: { staffId: string; status: string }) => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return updateStaffStatus(ctx.estateId, staffId, status as any);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['domestic-staff'] }),
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Update failed'),
  });

  function showStatusMenu(item) {
    const next = item.status === 'active' ? 'suspended' : 'active';
    Alert.alert(item.full_name, `Change status to ${next}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: next.charAt(0).toUpperCase() + next.slice(1), onPress: () => statusMutation.mutate({ staffId: item.id, status: next }) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={staff}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.heading}>Domestic Staff</Text>
            <Pressable style={styles.addBtn} onPress={() => setModal(true)}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
            : <View style={styles.empty}><Text style={styles.emptyText}>No staff registered yet.</Text></View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => showStatusMenu(item)}>
            <View style={styles.avatar}>
              <Ionicons name="briefcase" size={20} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.full_name}</Text>
              <Text style={styles.role}>{item.role}{item.phone ? ` · ${item.phone}` : ''}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] ?? '#94A3B8') + '20' }]}>
              <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] ?? '#94A3B8' }]}>
                {item.status}
              </Text>
            </View>
          </Pressable>
        )}
      />

      <Modal visible={modal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add Domestic Staff</Text>
            <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Full name *" placeholderTextColor={colors.neutral.placeholder} />
            <Text style={styles.chipLabel}>Role</Text>
            <View style={styles.chipRow}>
              {ROLES.map((r) => (
                <Pressable key={r} style={[styles.chip, role === r && styles.chipActive]} onPress={() => setRole(r)}>
                  <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Phone (optional)" placeholderTextColor={colors.neutral.placeholder} keyboardType="phone-pad" />
            <Pressable
              style={[styles.saveBtn, (!fullName || !role || addMutation.isPending) && styles.disabled]}
              onPress={() => addMutation.mutate()}
              disabled={!fullName || !role || addMutation.isPending}
            >
              {addMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Add Staff</Text>}
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
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F59E0B', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FEF9C3', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  role: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, marginBottom: 4 },
  input: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  chipLabel: { fontSize: 12, fontWeight: '600', color: colors.neutral.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  chipTextActive: { color: '#fff' },
  saveBtn: { backgroundColor: '#F59E0B', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontSize: 14, color: colors.neutral.textMuted },
});
