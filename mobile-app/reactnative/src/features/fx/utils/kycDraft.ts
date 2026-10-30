// A small module singleton the multi-step KYC flow reads/writes as the user
// progresses. Reset on entry (kyc/index). Kept out of React Query because it's
// transient client-only form state, not server data.

import type {
  AccountType, KycConsents, KycIdentity, KybBusiness, DirectorUbo, IdDocType,
} from '../types/fx.types';
import { resetFxKycSession } from './fxKycSession';

export interface KycDraft {
  accountType: AccountType;
  consents: KycConsents;
  identity: KycIdentity;
  business: KybBusiness;
  directors: DirectorUbo[];
  businessDocsUploaded: boolean;
}

function emptyDraft(): KycDraft {
  return {
    accountType: 'individual',
    consents: { terms: false, privacy: false, fxDisclosure: false },
    identity: {
      docType: 'nin' as IdDocType,
      idNumber: '',
      dateOfBirth: '',
      selfieUploaded: false,
    },
    business: { legalName: '', rcNumber: '', businessType: '', country: 'Nigeria', address: '' },
    directors: [],
    businessDocsUploaded: false,
  };
}

export const kycDraft: { current: KycDraft } = { current: emptyDraft() };

export function resetKycDraft(accountType: AccountType = 'individual') {
  kycDraft.current = emptyDraft();
  kycDraft.current.accountType = accountType;
  // A fresh FX attempt gets a fresh verification session; the server keys checks
  // to it, so a reused id would drag the previous attempt's consent/check history
  // into the new run.
  resetFxKycSession();
}
