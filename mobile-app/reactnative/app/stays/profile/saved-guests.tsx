import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, Trash2, Plus, BadgeCheck, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useSavedGuests, useAddSavedGuest, useRemoveSavedGuest } from '@/features/stays/reviews';

const DOC_LABEL: Record<string, string> = {
  passport: 'Passport',
  national_id: 'National ID',
  drivers_license: "Driver's licence",
};

export default function SavedGuestsScreen() {
  const guests = useSavedGuests();
  const addM = useAddSavedGuest();
  const removeM = useRemoveSavedGuest();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');

  function add() {
    if (!name.trim()) return;
    addM.mutate(
      { fullName: name.trim(), relationship: relationship.trim() || 'Guest' },
      {
        onSuccess: () => {
          setName('');
          setRelationship('');
          setShowAdd(false);
        },
      },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Saved guests"
        subtitle="Travel documents"
        rightSlot={
          <Pressable onPress={() => setShowAdd(true)} hitSlop={8} accessibilityLabel="Add guest">
            <Plus size={22} color={Colors.onSurface} />
          </Pressable>
        }
      />

      {guests.isLoading ? (
        <StateView kind="loading" message="Loading saved guests…" />
      ) : guests.isError ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => guests.refetch()} />
      ) : (guests.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Users" title="No saved guests" message="Add travellers and travel documents to speed up future bookings." actionLabel="Add guest" onAction={() => setShowAdd(true)} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {guests.data!.map((g) => (
            <View key={g.id} style={styles.card}>
              <View style={styles.avatar}><User size={20} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{g.fullName}</Text>
                <Text style={styles.sub}>{g.relationship}{g.dateOfBirth ? ` · ${g.dateOfBirth}` : ''}</Text>
                {g.docType ? (
                  <View style={styles.docRow}>
                    <BadgeCheck size={12} color={Colors.teal} />
                    <Text style={styles.docText}>{DOC_LABEL[g.docType]} · {g.docNumber}{g.docExpiry ? ` · exp ${g.docExpiry}` : ''}</Text>
                  </View>
                ) : (
                  <Text style={styles.noDoc}>No travel document on file</Text>
                )}
              </View>
              <Pressable onPress={() => removeM.mutate(g.id)} hitSlop={8} accessibilityLabel={`Remove ${g.fullName}`}>
                <Trash2 size={18} color={Colors.error} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Add guest</Text>
              <Pressable onPress={() => setShowAdd(false)} hitSlop={8}><X size={22} color={Colors.onSurfaceVariant} /></Pressable>
            </View>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={Colors.onSurfaceVariant} />
            <TextInput style={styles.input} value={relationship} onChangeText={setRelationship} placeholder="Relationship (e.g. Spouse, Child)" placeholderTextColor={Colors.onSurfaceVariant} />
            <PrimaryButton label={addM.isPending ? 'Adding…' : 'Add guest'} loading={addM.isPending} disabled={!name.trim()} onPress={add} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  docText: { ...Typography.caption, color: Colors.onSurface },
  noDoc: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4, fontStyle: 'italic' },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface },
});
