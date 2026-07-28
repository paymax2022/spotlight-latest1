// Device-first contacts with seed fallback, behind one hook so the
// ContactPickerModal contract is unchanged. Tries the real device address book
// (expo-contacts); if unavailable/denied, falls back to the simulated phonebook.

import { useQuery } from '@tanstack/react-query';
import { getDeviceContacts } from '@/lib/contacts';
import * as api from '../api/visitor.api';
import { visitorKeys } from './useVisitor';
import type { PhonebookContact } from '../types/visitor.types';

export function useContacts(query: string) {
  return useQuery<PhonebookContact[]>({
    queryKey: visitorKeys.contacts(query),
    queryFn: async () => {
      const device = await getDeviceContacts();
      const all = device ?? (await api.listPhonebookContacts(''));
      const q = query.trim().toLowerCase();
      return q ? all.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)) : all;
    },
    staleTime: 60_000,
  });
}
