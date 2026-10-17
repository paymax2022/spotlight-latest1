import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { usePet, useCreatePet, useUpdatePet } from '@/features/health/vet/hooks';
import { SPECIES_OPTIONS, SEX_OPTIONS, BREEDS_BY_SPECIES, BREED_OTHER } from '@/features/health/vet/constants';
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
  const [customBreed, setCustomBreed] = useState('');
  const [submitErr, setSubmitErr] = useState<string>();
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
      if (BREEDS_BY_SPECIES[pet.species].includes(pet.breed)) {
        setBreed(pet.breed);
      } else {
        setBreed(BREED_OTHER);
        setCustomBreed(pet.breed);
      }
      setSex(pet.sex);
      setDob(pet.dob ? pet.dob.slice(0, 10) : '');
      setWeight(pet.weightKg != null ? String(pet.weightKg) : '');
      setMicrochip(pet.microchipId ?? '');
      setNotes(pet.notes ?? '');
      setHydrated(true);
    }
  }, [editing, pet, hydrated]);

  const onSubmit = () => {
    const finalBreed = breed === BREED_OTHER ? customBreed.trim() : breed;
    const e: { name?: string; breed?: string } = {};
    if (!name.trim()) e.name = 'Pet name is required';
    if (!finalBreed) e.breed = breed === BREED_OTHER ? 'Please enter the breed' : 'Breed is required';
    setErrors(e);
    setSubmitErr(undefined);
    if (Object.keys(e).length) return;

    const dobDate = dob ? new Date(dob) : undefined;
    if (dobDate && Number.isNaN(dobDate.getTime())) {
      setSubmitErr('Date of birth is not a valid date.');
      return;
    }
    const input = {
      name: name.trim(),
      species,
      breed: finalBreed,
      sex,
      dob: dobDate?.toISOString(),
      weightKg: weight ? Number(weight) : undefined,
      microchipId: microchip.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    const action = editing ? updatePet.mutateAsync(input) : createPet.mutateAsync(input);
    action
      .then((p) => router.replace({ pathname: '/health/vet/pet/[id]', params: { id: p.id } }))
      .catch((err) => {
        const x = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
        setSubmitErr(x?.response?.data?.message ?? x?.response?.data?.error ?? x?.message ?? 'Could not save your pet. Please try again.');
      });
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
        <SegmentedControl
          options={SPECIES_OPTIONS}
          value={species}
          onChange={(v) => { setSpecies(v); setBreed(''); setCustomBreed(''); }}
          scrollable
        />

        <SelectField
          label="Breed *"
          placeholder="Select a breed"
          value={breed || undefined}
          options={BREEDS_BY_SPECIES[species]}
          onChange={setBreed}
          error={breed === BREED_OTHER ? undefined : errors.breed}
        />
        {breed === BREED_OTHER && (
          <TextInputField label="Breed name *" placeholder="Enter breed" value={customBreed} onChangeText={setCustomBreed} error={errors.breed} />
        )}

        <Text style={styles.label}>Sex</Text>
        <SegmentedControl options={SEX_OPTIONS} value={sex} onChange={setSex} />

        <DatePickerField
          label="Date of birth"
          value={dob || undefined}
          onChange={setDob}
          minYear={new Date().getFullYear() - 40}
          maxYear={new Date().getFullYear()}
        />
        <TextInputField label="Weight (kg)" placeholder="e.g. 48" value={weight} onChangeText={setWeight} keyboardType="numeric" />
        <TextInputField label="Microchip ID" placeholder="Optional" value={microchip} onChangeText={setMicrochip} />
        <TextInputField label="Notes" placeholder="Allergies, temperament, etc." value={notes} onChangeText={setNotes} multiline />
      </ScrollView>

      <View style={styles.footer}>
        {!!submitErr && <Text style={styles.submitErr}>{submitErr}</Text>}
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
  submitErr: { ...Typography.bodySm, color: Colors.error, marginBottom: Spacing.sm, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
