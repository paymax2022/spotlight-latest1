import type { ProfessionalRole } from './requirements';

export type { ProfessionalRole };

export type RoleProfileStatus = 'draft' | 'active' | 'suspended';
export type RoleVerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type RoleDocumentKind = 'agent_licence' | 'cac_certificate' | 'authority_letter' | 'id_document';

export interface RoleDocument {
  id: string;
  kind: string;
  storageKey: string;
  createdAt: string;
}

export interface RoleProfile {
  id: string;
  userId: string;
  role: ProfessionalRole;
  status: RoleProfileStatus;
  verificationStatus: RoleVerificationStatus;
  displayName: string;
  details: Record<string, unknown>;
  rejectionReason?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  documents: RoleDocument[];
}

export interface RegisterRoleInput {
  role: ProfessionalRole;
  displayName: string;
  details?: Record<string, unknown>;
}

export interface UpdateRoleInput {
  displayName?: string;
  details?: Record<string, unknown>;
}

export interface RoleDocumentPresign {
  uploadUrl: string;
  storageKey: string;
  contentType: string;
  expiresIn: number;
  method: string;
}

export interface UploadRoleDocumentInput {
  kind: RoleDocumentKind;
  localUri: string;
  fileName: string;
  /** Picker-reported MIME type; falls back to the file extension. */
  mimeType?: string;
}
