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
import { alertAsync } from '@/lib/confirm';
import { useIdempotencyKey } from '@/utils/idempotency';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { usePet, useCreatePet, useUpdatePet } from '@/features/health/vet/hooks';
import { SPECIES_OPTIONS, SEX_OPTIONS } from '@/features/health/vet/constants';
import {
  OTHER_BREED,
  breedChoiceFor,
  breedFromChoice,
  breedOptions,
  isAfterDate,
  localIsoDate,
  petErrorMessage,
} from '@/features/health/vet/petForm';
import type { PetSpecies, PetSex } from '@/features/health/vet/types';

type FieldErrors = { name?: string; breed?: string; dob?: string; weight?: string };

export default function PetAddScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const { data: pet, isLoading } = usePet(id);
  const createPet = useCreatePet();
  const updatePet = useUpdatePet(id);
  // One key per form: a retried submit (after a dropped connection, say) replays
  // the same key, so the server returns the pet it already made.
  const { key: idemKey, reset: resetIdem } = useIdempotencyKey();

  const [name, setName] = useState('');
  const [species, setSpecies] = useState<PetSpecies>('dog');
  const [breedChoice, setBreedChoice] = useState('');
  const [breedText, setBreedText] = useState('');
  const [sex, setSex] = useState<PetSex>('male');
  const [dob, setDob] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Read on every render so the widget always caps at the current day.
  const today = localIsoDate(new Date());

  React.useEffect(() => {
    if (editing && pet && !hydrated) {
      setName(pet.name);
      setSpecies(pet.species);
      const b = breedChoiceFor(pet.species, pet.breed);
      setBreedChoice(b.choice);
      setBreedText(b.typed);
      setSex(pet.sex);
      setDob(pet.dob ? pet.dob.slice(0, 10) : '');
      setWeight(pet.weightKg != null ? String(pet.weightKg) : '');
      setNotes(pet.notes ?? '');
      setHydrated(true);
    }
  }, [editing, pet, hydrated]);

  const onSpeciesChange = (next: PetSpecies) => {
    setSpecies(next);
    // A breed picked for the old species is not valid for the new one.
    if (breedChoice && !breedOptions(next).includes(breedChoice)) {
      setBreedChoice('');
      setBreedText('');
    }
  };

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = 'Pet name is required';
    if (!breedChoice) e.breed = 'Choose a breed';
    else if (breedChoice === OTHER_BREED && !breedText.trim()) e.breed = 'Type the breed';
    if (dob && isAfterDate(dob, today)) e.dob = 'Date of birth cannot be in the future';
    if (weight && !(Number(weight) > 0)) e.weight = 'Enter a weight above 0 kg';
    return e;
  };

  const onSubmit = async () => {
    if (saving) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;

    const input = {
      name: name.trim(),
      species,
      breed: breedFromChoice(breedChoice, breedText),
      sex,
      dob: dob || undefined,
      weightKg: weight ? Number(weight) : undefined,
      notes: notes.trim() || undefined,
      idempotencyKey: editing ? undefined : idemKey,
    };

    setSaving(true);
    try {
      const saved = editing ? await updatePet.mutateAsync(input) : await createPet.mutateAsync(input);
      if (!editing) resetIdem();
      router.replace({ pathname: '/health/vet/pet/[id]', params: { id: saved.id } });
    } catch (err) {
      // Stay on the form with the owner's entries kept; say why it failed.
      await alertAsync({
        title: editing ? "Couldn't save changes" : "Couldn't add your pet",
        message: petErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
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
        <SegmentedControl options={SPECIES_OPTIONS} value={species} onChange={onSpeciesChange} scrollable />

        <SelectField
          label="Breed *"
          placeholder="Select a breed"
          options={breedOptions(species)}
          value={breedChoice || undefined}
          onChange={setBreedChoice}
          error={errors.breed}
        />
        {breedChoice === OTHER_BREED ? (
          <TextInputField
            label="Describe the breed *"
            placeholder="e.g. Kangal"
            value={breedText}
            onChangeText={setBreedText}
          />
        ) : null}

        <Text style={styles.label}>Sex</Text>
        <SegmentedControl options={SEX_OPTIONS} value={sex} onChange={setSex} />

        <DatePickerField
          label="Date of birth"
          value={dob || undefined}
          onChange={setDob}
          maxDate={today}
          error={errors.dob}
        />
        <TextInputField
          label="Weight (kg)"
          placeholder="e.g. 48"
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          error={errors.weight}
        />
        <TextInputField label="Notes" placeholder="Allergies, temperament, etc." value={notes} onChangeText={setNotes} multiline />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={editing ? 'Save changes' : 'Add pet'}
          onPress={onSubmit}
          loading={saving || createPet.isPending || updatePet.isPending}
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
