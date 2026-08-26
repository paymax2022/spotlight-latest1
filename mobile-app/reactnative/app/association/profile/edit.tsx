import React, { useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, Image, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { useMyProfile, useUpdateProfile } from '@/features/association/hooks/useProfile';
import { pickDocument } from '@/features/association/utils/docPicker';
import { initials } from '@/features/association/utils/associationFormatters';
import type { ProfileEdit } from '@/features/association/types/profile.types';

export default function EditProfile() {
  const profile = useMyProfile();
  const update = useUpdateProfile();
  const [form, setForm] = useState<ProfileEdit | null>(null);

  // Seed local form once profile loads.
  const p = profile.data;
  const f: ProfileEdit | null = form ?? (p ? {
    fullName: p.fullName, phone: p.phone, email: p.email, profession: p.profession,
    location: p.location, dob: p.dob, bio: p.bio, emergency: p.emergency, nextOfKin: p.nextOfKin, photoUrl: p.photoUrl,
  } : null);

  if (profile.isLoading || !f) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Edit profile" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  const set = <K extends keyof ProfileEdit>(key: K, val: ProfileEdit[K]) => setForm({ ...f, [key]: val });

  const onPickPhoto = async () => {
    const picked = await pickDocument();
    if (picked) set('photoUrl', picked.uri);
  };

  const onSave = () => {
    if (!f.fullName.trim()) { Alert.alert('Name required', 'Please enter your full name.'); return; }
    update.mutate(f, {
      onSuccess: () => router.back(),
      onError: () => Alert.alert('Could not save', 'Please try again.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Edit profile" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Photo */}
        <View style={styles.photoWrap}>
          <Pressable onPress={onPickPhoto} accessibilityRole="button" accessibilityLabel="Change profile photo">
            <View style={styles.avatar}>
              {f.photoUrl ? <Image source={{ uri: f.photoUrl }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{initials(f.fullName)}</Text>}
              <View style={styles.cameraBadge}><Camera size={14} color={Colors.onPrimary} strokeWidth={2.2} /></View>
            </View>
          </Pressable>
          <Text style={styles.photoHint}>Tap to change photo</Text>
        </View>

        <TextInputField label="Full name" value={f.fullName} onChangeText={(t) => set('fullName', t)} />
        <PhoneNumberInput label="Phone" value={f.phone} onChange={({ e164, nsn }) => ((t) => set('phone', t))(e164 || nsn)} />
        <TextInputField label="Email" value={f.email} onChangeText={(t) => set('email', t)} keyboardType="email-address" autoCapitalize="none" />
        <TextInputField label="Profession" value={f.profession} onChangeText={(t) => set('profession', t)} />
        <TextInputField label="Location" value={f.location} onChangeText={(t) => set('location', t)} />
        <DatePickerField label="Date of birth (optional)" value={f.dob ?? undefined} onChange={(iso) => set('dob', iso)} />
        <TextInputField label="Bio" value={f.bio} onChangeText={(t) => set('bio', t)} multiline numberOfLines={3} />

        <Text style={styles.sectionTitle}>Emergency contact</Text>
        <TextInputField label="Name" value={f.emergency.name} onChangeText={(t) => set('emergency', { ...f.emergency, name: t })} />
        <PhoneNumberInput label="Phone" value={f.emergency.phone} onChange={({ e164, nsn }) => ((t) => set('emergency', { ...f.emergency, phone: t }))(e164 || nsn)} />

        <Text style={styles.sectionTitle}>Next of kin</Text>
        <TextInputField label="Name" value={f.nextOfKin.name} onChangeText={(t) => set('nextOfKin', { ...f.nextOfKin, name: t })} />
        <TextInputField label="Relationship" value={f.nextOfKin.relationship} onChangeText={(t) => set('nextOfKin', { ...f.nextOfKin, relationship: t })} />
        <PhoneNumberInput label="Phone" value={f.nextOfKin.phone} onChange={({ e164, nsn }) => ((t) => set('nextOfKin', { ...f.nextOfKin, phone: t }))(e164 || nsn)} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Save changes" onPress={onSave} loading={update.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  photoWrap: { alignItems: 'center', gap: 6 },
  avatar: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { ...Typography.headlineMd, color: Colors.primary },
  cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.background },
  photoHint: { ...Typography.labelSm, color: Colors.secondary },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
