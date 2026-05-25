export interface AdminSettings {
  siteName: string;
  logoUrl?: string;
  contactEmail: string;
  defaultCurrency: string;
  defaultVotePrice: number;
  registrationEnabled: boolean;
  votingEnabled: boolean;
  uploadMaxMb: number;
  allowedFileTypes: string[];
  maintenanceMode: boolean;
  termsUrl?: string;
  privacyUrl?: string;
}

interface SettingsStore {
  value: AdminSettings;
}

function getStore(): SettingsStore {
  const key = '__spotlightAdminSettingsStore';
  const g = globalThis as unknown as Record<string, SettingsStore | undefined>;
  if (!g[key]) {
    g[key] = {
      value: {
        siteName: 'Spotlight',
        contactEmail: 'info@spotlight.ng',
        defaultCurrency: 'NGN',
        defaultVotePrice: 100,
        registrationEnabled: true,
        votingEnabled: true,
        uploadMaxMb: 100,
        allowedFileTypes: ['jpg', 'png', 'pdf', 'mp4', 'mp3', 'wav', 'docx'],
        maintenanceMode: false,
        termsUrl: '/terms',
        privacyUrl: '/privacy',
      },
    };
  }
  return g[key] as SettingsStore;
}

export function getAdminSettings() {
  return getStore().value;
}

export function updateAdminSettings(patch: Partial<AdminSettings>) {
  const current = getStore().value;
  const next: AdminSettings = {
    ...current,
    ...patch,
    allowedFileTypes: Array.isArray(patch.allowedFileTypes)
      ? patch.allowedFileTypes
      : current.allowedFileTypes,
  };
  getStore().value = next;
  return next;
}

