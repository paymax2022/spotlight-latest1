// Pure helpers for the add/edit pet form and its wire shape. No React Native or
// '@/' imports, so they run under node:test.

import type { PetInput, PetSpecies } from './types';

export const OTHER_BREED = 'Other';
const MIXED = 'Mixed breed';

// Common breeds a Nigerian owner will recognise. Anything not listed is picked
// as "Other" and typed in, so the list never blocks a real pet.
export const BREEDS: Record<PetSpecies, string[]> = {
  dog: [
    'Boerboel', 'Nigerian local dog', 'German Shepherd', 'Labrador Retriever', 'Golden Retriever',
    'Bulldog', 'French Bulldog', 'Pug', 'Rottweiler', 'Doberman Pinscher', 'Dachshund', 'Beagle',
    'Poodle', 'Chihuahua', 'Siberian Husky', 'Boxer', 'Yorkshire Terrier', 'Shih Tzu', 'Maltese',
    'Great Dane', 'Pit Bull Terrier', 'Cocker Spaniel', 'Mastiff', 'Akita', 'Shiba Inu', MIXED,
  ],
  cat: [
    'Domestic Shorthair', 'Persian', 'Maine Coon', 'Siamese', 'British Shorthair', 'Ragdoll',
    'Bengal', 'Sphynx', 'Scottish Fold', 'Abyssinian', MIXED,
  ],
  bird: ['Budgerigar (budgie)', 'Cockatiel', 'African Grey', 'Amazon parrot', 'Macaw', 'Cockatoo', 'Canary', 'Lovebird', 'Finch', MIXED],
  rabbit: ['Netherland Dwarf', 'Holland Lop', 'Mini Rex', 'Lionhead', 'Rex', 'New Zealand', 'Flemish Giant', MIXED],
  reptile: ['Ball python', 'Corn snake', 'Bearded dragon', 'Leopard gecko', 'Green iguana', 'Red-eared slider', 'Tortoise', 'Chameleon', MIXED],
  other: [MIXED],
};

export function breedOptions(species: PetSpecies): string[] {
  return [...BREEDS[species], OTHER_BREED];
}

/** The dropdown value and the typed text that together make up a breed. */
export function breedChoiceFor(species: PetSpecies, breed: string): { choice: string; typed: string } {
  const b = breed.trim();
  if (!b) return { choice: '', typed: '' };
  if (BREEDS[species].includes(b)) return { choice: b, typed: '' };
  return { choice: OTHER_BREED, typed: b };
}

/** The breed to save: the picked option, or the typed text when "Other" is picked. */
export function breedFromChoice(choice: string, typed: string): string {
  return choice === OTHER_BREED ? typed.trim() : choice;
}

/** A calendar date as YYYY-MM-DD in the device's local time. */
export function localIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** YYYY-MM-DD strings order correctly as text, so a plain comparison is exact. */
export function isAfterDate(iso: string, reference: string): boolean {
  return iso > reference;
}

/**
 * The body the server expects. The server's field names are snake_case and its
 * enums are upper-case codes; the form's are camelCase and lower-case.
 */
export function toWirePet(input: PetInput) {
  return {
    name: input.name.trim(),
    species: input.species.toUpperCase(),
    breed: input.breed.trim(),
    sex: input.sex.toUpperCase(),
    birth_date: input.dob || undefined,
    weight_kg: input.weightKg ?? undefined,
    notes: input.notes?.trim() || undefined,
  };
}

/**
 * What to show the owner when a save fails. The server's own message is used
 * when it has one (it is written for owners); otherwise a plain reason.
 */
export function petErrorMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { error?: unknown } }; message?: unknown } | null;
  const msg = e?.response?.data?.error;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (e?.response) return `The server could not save this pet (${e.response.status ?? 'error'}). Try again.`;
  return 'No connection to the server. Check your internet and try again.';
}
