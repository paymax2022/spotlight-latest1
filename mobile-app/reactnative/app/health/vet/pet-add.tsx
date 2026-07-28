import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { usePet, useCreatePet, useUpdatePet } from '@/features/health/vet/hooks';
import { SPECIES_OPTIONS, SEX_OPTIONS } from '@/features/health/vet/constants';
import type { PetSpecies, PetSex } from '@/features/health/vet/types';

export default function PetAddScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const { data: pet, isLoading } = usePet(id);
  const createPet = useCreatePet();
  const updatePet = useUpdatePet(id);

  const [name, setName] = useState('');
  const [species, setSpecies] = useState<PetSpecies>('dog');
  const [breed, setBreed] = useState('');
  const [sex, setSex] = useState<PetSex>('male');
  const [dob, setDob] = useState('');
  const [weight, setWeight] = useState('');
  const [microchip, setMicrochip] = useState('');
  const [notes, setNotes] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; breed?: string }>({});

  React.useEffect(() => {
    if (editing && pet && !hydrated) {
      setName(pet.name);
      setSpecies(pet.species);
      setBreed(pet.breed);
      setSex(pet.sex);
      setDob(pet.dob ? pet.dob.slice(0, 10) : '');
      setWeight(pet.weightKg != null ? String(pet.weightKg) : '');
      setMicrochip(pet.microchipId ?? '');
      setNotes(pet.notes ?? '');
      setHydrated(true);
    }
  }, [editing, pet, hydrated]);

  const onSubmit = () => {
    const e: { name?: string; breed?: string } = {};
    if (!name.trim()) e.name = 'Pet name is required';
    if (!breed.trim()) e.breed = 'Breed is required';
    setErrors(e);
    if (Object.keys(e).length) return;

    const input = {
      name: name.trim(),
      species,
      breed: breed.trim(),
      sex,
      dob: dob ? new Date(dob).toISOString() : undefined,
      weightKg: weight ? Number(weight) : undefined,
      microchipId: microchip.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    const action = editing ? updatePet.mutateAsync(input) : createPet.mutateAsync(input);
    action.then((p) => router.replace({ pathname: '/health/vet/pet/[id]', params: { id: p.id } }));
  };

  if (editing && isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Edit pet" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={editing ? 'Edit pet' : 'Add a pet'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TextInputField label="Pet name *" placeholder="e.g. Bella" value={name} onChangeText={setName} error={errors.name} />

        <Text style={styles.label}>Species *</Text>
        <SegmentedControl options={SPECIES_OPTIONS} value={species} onChange={setSpecies} scrollable />

        <TextInputField label="Breed *" placeholder="e.g. Boerboel" value={breed} onChangeText={setBreed} error={errors.breed} />

        <Text style={styles.label}>Sex</Text>
        <SegmentedControl options={SEX_OPTIONS} value={sex} onChange={setSex} />

        <TextInputField label="Date of birth" placeholder="YYYY-MM-DD" value={dob} onChangeText={setDob} />
        <TextInputField label="Weight (kg)" placeholder="e.g. 48" value={weight} onChangeText={setWeight} keyboardType="numeric" />
        <TextInputField label="Microchip ID" placeholder="Optional" value={microchip} onChangeText={setMicrochip} />
        <TextInputField label="Notes" placeholder="Allergies, temperament, etc." value={notes} onChangeText={setNotes} multiline />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={editing ? 'Save changes' : 'Add pet'}
          onPress={onSubmit}
          loading={createPet.isPending || updatePet.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: 40 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
