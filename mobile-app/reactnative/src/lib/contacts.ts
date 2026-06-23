// ── Device phonebook (expo-contacts) ─────────────────────────────────────────
// Reads the device address book with permission. Returns null when the package
// is unavailable, permission is denied, or there are no contacts, so callers can
// fall back to the seed list. Requires: npx expo install expo-contacts

import * as Contacts from 'expo-contacts';
import type { PhonebookContact } from '@/features/visitor/types/visitor.types';

export async function getDeviceContacts(): Promise<PhonebookContact[] | null> {
  try {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') return null;

    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
    });

    const mapped: PhonebookContact[] = data
      .filter((c) => !!c.name && !!c.phoneNumbers?.length)
      .map((c, i) => ({
        id: c.id ?? `${c.name}-${i}`,
        name: c.name as string,
        phone: c.phoneNumbers?.[0]?.number ?? '',
      }))
      .filter((c) => c.phone);

    return mapped.length ? mapped : null;
  } catch {
    return null;
  }
}
