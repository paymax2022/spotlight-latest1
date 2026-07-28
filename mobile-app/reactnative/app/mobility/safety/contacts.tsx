import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Trash2, UserPlus, Shield } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useSafety } from '@/features/mobility/hooks/useMobility';
import type { TrustedContact } from '@/features/mobility/types/mobility.types';

export default function TrustedContactsScreen() {
  const { contacts, addContact, deleteContact } = useSafety();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onAdd = () => {
    setError(null);
    if (!name.trim()) { setError('Enter a name.'); return; }
    if (!/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ''))) { setError('Enter a valid phone number.'); return; }
    addContact.mutate(
      { name: name.trim(), phone: phone.trim() },
      { onSuccess: () => { setName(''); setPhone(''); } },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Trusted contacts" />

      {contacts.isLoading ? (
        <StateView kind="loading" message="Loading contacts…" />
      ) : contacts.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => contacts.refetch()} />
      ) : (
        <FlatList
          data={contacts.data}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.intro}>
              <View style={styles.introIcon}><Shield size={20} color={Colors.tertiaryContainer} strokeWidth={2.2} /></View>
              <Text style={styles.introText}>Trusted contacts can be auto-notified when you share a trip or trigger SOS.</Text>
            </View>
          }
          ListEmptyComponent={
            <MobilityEdgeState kind="empty" compact title="No trusted contacts" message="Add someone you trust to keep them in the loop on your trips." />
          }
          renderItem={({ item }) => (
            <ContactRow contact={item} onDelete={() => deleteContact.mutate(item.id)} deleting={deleteContact.isPending} />
          )}
          ListFooterComponent={
            <View style={styles.form}>
              <Text style={styles.formTitle}>Add a contact</Text>
              <TextInputField label="Name" placeholder="e.g. Ada (sister)" value={name} onChangeText={setName} />
              <TextInputField label="Phone" placeholder="+234…" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PrimaryButton label="Add contact" onPress={onAdd} loading={addContact.isPending} />
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function ContactRow({ contact, onDelete, deleting }: { contact: TrustedContact; onDelete: () => void; deleting: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.avatar}><UserPlus size={18} color={Colors.secondary} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{contact.name}</Text>
        <Text style={styles.phone}>{contact.phone}</Text>
      </View>
      <Pressable onPress={onDelete} disabled={deleting} hitSlop={8} accessibilityLabel={`Remove ${contact.name}`}>
        <Trash2 size={18} color={Colors.error} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  intro: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.tertiaryFixed, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  introIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  introText: { ...Typography.labelSm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  avatar: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.secondaryFixed, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  phone: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  form: { marginTop: Spacing.lg, gap: Spacing.xs },
  formTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  error: { ...Typography.labelSm, color: Colors.error, marginBottom: Spacing.sm },
});
