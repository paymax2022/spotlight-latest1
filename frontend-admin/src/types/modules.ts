export type ModuleEnvironment = 'development' | 'staging' | 'production';
/**
 * Per-environment module state.
 *   hidden      — not rendered in the app
 *   coming_soon — rendered as a teaser, but inert (not tappable)
 *   visible     — rendered and fully functional
 */
export type ModuleStatus = 'hidden' | 'coming_soon' | 'visible';
export type ModuleLifecycle = 'active' | 'archived';
/**
 * How far the module's own product work has come — a statement about the product,
 * not about a deployment. Production will not serve a module that is not 'ready',
 * whatever its production toggle says, so this is the field that answers the
 * operator's actual question: "is this finished enough for real users yet?"
 *
 *   in_development — not finished; must not reach live users
 *   testing        — usable by testers in staging/dev, still not for the public
 *   ready          — cleared for production publication
 */
export type ModuleReadiness = 'in_development' | 'testing' | 'ready';

export const MODULE_ENVIRONMENTS: ModuleEnvironment[] = ['development', 'staging', 'production'];

export const MODULE_READINESS_LEVELS: ModuleReadiness[] = ['in_development', 'testing', 'ready'];

export const MODULE_READINESS_LABELS: Record<ModuleReadiness, string> = {
  in_development: 'In development',
  testing: 'In testing',
  ready: 'Ready for the public',
};

/**
 * A missing readiness means the backend predates this column, or the migration has
 * not run on this database. Either way the server's own default is 'in_development'
 * (COALESCE in its query), so the console must read it the same way — showing
 * 'ready' here would advertise a launch the server will refuse.
 */
export function readinessOf(m: PlatformModule): ModuleReadiness {
  return m.readiness ?? 'in_development';
}

export interface ModuleEnvironmentState {
  environment: ModuleEnvironment;
  status: ModuleStatus;
  note?: string;
  updated_at?: string;
  updated_by?: string;
}

export interface PlatformModule {
  /** 'general' = any signed-in user; 'restricted' = needs KYC tier >= 1 or a grant. */
  access_level?: 'general' | 'restricted';
  key: string;
  name: string;
  category: string;
  env_flag?: string;
  description?: string;
  lifecycle: ModuleLifecycle;
  /** Product-readiness axis. Absent only against a backend predating the column. */
  readiness?: ModuleReadiness;
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
  /**
   * 'readiness' is the odd one out: it records a product decision, not a visibility
   * change. It is in the trail because "who said this was ready, and when" is the
   * first question asked after a module that was not ready reached the store build.
   */
  action: 'publish' | 'hide' | 'archive' | 'restore' | 'readiness';
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
 *
 * The checks below are in the server's order, because the ORDER decides which
 * reason an operator is given: lifecycle, then the ops flag, then production
 * readiness, then the tier's own row.
 */
export function effectiveVisibility(
  m: PlatformModule,
  env: ModuleEnvironment,
): { visible: boolean; reason: string } {
  if (m.lifecycle === 'archived') return { visible: false, reason: 'Archived' };
  if (!m.env_flag_enabled) {
    return { visible: false, reason: `Ops flag off (${m.env_flag ?? 'unset'})` };
  }
  if (env === 'production' && readinessOf(m) !== 'ready') {
    return {
      visible: false,
      reason: `Not marked ready (currently "${MODULE_READINESS_LABELS[readinessOf(m)]}")`,
    };
  }
  const st = m.environments[env];
  if (!st) return { visible: false, reason: 'Never published here' };
  if (st.status !== 'visible') return { visible: false, reason: 'Hidden' };
  return { visible: true, reason: 'Live' };
}
