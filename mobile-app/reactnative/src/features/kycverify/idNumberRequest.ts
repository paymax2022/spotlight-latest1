// Pure builder for the ID-number data-match request body. Kept alias-free (no
// `@/` imports) so it is unit-testable without the axios client, and so the
// "we never send a user-typed name/DOB" rule is locked by a test.
//
// The KYC form no longer collects the holder's name or date of birth: the
// provider (Dojah) returns the authoritative legal name + DOB from the NIN/BVN
// lookup, and the backend persists those server-side. The client sends ONLY the
// session id and the ID number.
import type { IdType } from './types';

export interface IdNumberCheckInput {
  sessionId: string;
  idType: IdType;
  idNumber: string;
}

export function idNumberRequestBody(input: IdNumberCheckInput): {
  session_id: string;
  id_type: IdType;
  id_number: string;
  consent: {
    value: boolean;
    description: string;
  };
} {
  return {
    session_id: input.sessionId,
    id_type: input.idType,
    id_number: input.idNumber,
    consent: {
      value: true,
      description: 'The user has consented to this verification check.',
    },
  };
}
