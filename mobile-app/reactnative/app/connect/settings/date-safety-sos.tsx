import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Siren, Plus, Phone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import ToggleRow from '@/features/connect/components/ToggleRow';
import {
  useDateSafetyState,
  useUpdateDateSafetyState,
  useAddSosContact,
} from '@/features/connect/hooks/useConnect';

// ST-10 — Date safety / SOS. Share trip, emergency contacts, check-in.
export default function DateSafetySos() {
  const { data, isLoading, error, refetch } = useDateSafetyState();
  const update = useUpdateDateSafetyState();
  const addContact = useAddSosContact();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const onAdd = () => {
    addContact.mutate(
      { name: name.trim(), phone: phone.trim() },
      { onSuccess: () => { setAdding(false); setName(''); setPhone(''); } },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Date safety & SOS" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error || !data ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}><Siren size={24} color={Colors.onPrimary} strokeWidth={2} /></View>
            <Text style={styles.heroTitle}>Stay safe on dates</Text>
            <Text style={styles.heroBody}>Share your plans, check in, and keep a trusted contact ready.</Text>
          </View>

          <View style={styles.card}>
            <ToggleRow label="Trip sharing" sub="Share your location with a contact during a date" value={data.tripSharingEnabled} onValueChange={(v) => update.mutate({ tripSharingEnabled: v })} divider />
            <ToggleRow label="Check-in reminders" sub="We'll nudge you to confirm you're safe" value={data.checkInEnabled} onValueChange={(v) => update.mutate({ checkInEnabled: v })} />
          </View>

          <View style={styles.contactsHead}>
            <Text style={styles.group}>Emergency contacts</Text>
            <Pressable onPress={() => setAdding(true)} hitSlop={8} style={styles.addBtn}>
              <Plus size={16} color={Colors.secondary} strokeWidth={2.5} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>

          {data.contacts.length > 0 ? (
            <View style={styles.card}>
              {data.contacts.map((c, i, arr) => (
                <View key={c.id} style={[styles.contactRow, i < arr.length - 1 && styles.divider]}>
                  <View style={styles.contactIcon}><Phone size={16} color={Colors.primary} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactPhone}>{c.phone}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <StateView kind="empty" compact icon="Phone" title="No contacts yet" message="Add a trusted person we can alert in an emergency." />
          )}
        </ScrollView>
      )}

      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add emergency contact</Text>
            <TextInputField label="Name" value={name} onChangeText={setName} placeholder="e.g. Mum" autoCapitalize="words" />
            <TextInputField label="Phone" value={phone} onChangeText={setPhone} placeholder="e.g. 0803 000 0000" keyboardType="phone-pad" />
            <PrimaryButton label="Add contact" onPress={onAdd} disabled={name.trim().length < 2 || phone.trim().length < 6} loading={addContact.isPending} />
            <PrimaryButton label="Cancel" variant="ghost" onPress={() => setAdding(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md, paddingTop: Spacing.sm },
  heroCard: { backgroundColor: Colors.error, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  heroIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.titleMd, color: Colors.onPrimary, marginTop: Spacing.xs },
  heroBody: { ...Typography.bodySm, color: Colors.errorContainer },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  contactsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  group: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addText: { ...Typography.labelMd, color: Colors.secondary },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  contactIcon: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  contactName: { ...Typography.labelLg, color: Colors.onSurface },
  contactPhone: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.xs },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.sm },
});
