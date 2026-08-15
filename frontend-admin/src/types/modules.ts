export type ModuleEnvironment = 'development' | 'staging' | 'production';
export type ModuleStatus = 'hidden' | 'visible';
export type ModuleLifecycle = 'active' | 'archived';

export const MODULE_ENVIRONMENTS: ModuleEnvironment[] = ['development', 'staging', 'production'];

export interface ModuleEnvironmentState {
  environment: ModuleEnvironment;
  status: ModuleStatus;
  note?: string;
  updated_at?: string;
  updated_by?: string;
}

export interface PlatformModule {
  key: string;
  name: string;
  category: string;
  env_flag?: string;
  description?: string;
  lifecycle: ModuleLifecycle;
  created_at: string;
  environments: Partial<Record<ModuleEnvironment, ModuleEnvironmentState>>;
  /**
   * The ops kill switch (FEATURE_*) as read by the backend process serving this
   * console. Reported so an operator can tell "I haven't published it" apart from
   * "ops has it switched off" — otherwise a published-but-invisible module looks
   * like a broken toggle.
   */
  env_flag_enabled: boolean;
}

export interface ModuleRegistry {
  /** The tier the backend serving this console is running as. */
  environment: ModuleEnvironment;
  modules: PlatformModule[];
}

export interface ModuleAuditEntry {
  module_key: string;
  environment?: string;
  action: 'publish' | 'hide' | 'archive' | 'restore';
  before?: string;
  after: string;
  note?: string;
  actor_id?: string;
  created_at: string;
}

/**
 * Mirrors the server's visibility rule (modules.Module.VisibleIn) so the console
 * can explain the outcome. It is NOT an authority — the server decides. It exists
 * so the UI can say why a row is dark rather than showing a toggle whose state
 * appears to disagree with reality.
 */
export function effectiveVisibility(
  m: PlatformModule,
  env: ModuleEnvironment,
): { visible: boolean; reason: string } {
  if (m.lifecycle === 'archived') return { visible: false, reason: 'Archived' };
  if (!m.env_flag_enabled) {
    return { visible: false, reason: `Ops flag off (${m.env_flag ?? 'unset'})` };
  }
  const st = m.environments[env];
  if (!st) return { visible: false, reason: 'Never published here' };
  if (st.status !== 'visible') return { visible: false, reason: 'Hidden' };
  return { visible: true, reason: 'Live' };
}
