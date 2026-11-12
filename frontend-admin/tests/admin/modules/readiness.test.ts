import { describe, expect, it } from 'vitest';
import {
  effectiveVisibility,
  readinessOf,
  type ModuleReadiness,
  type ModuleStatus,
  type PlatformModule,
} from '@/types/modules';

/**
 * effectiveVisibility is a MIRROR of the server rule (modules.Module.VisibleIn), and
 * the mirror is what makes this console trustworthy: an operator who is told a module
 * is live while the app hides it stops believing the tool. So these cases assert the
 * server's order of checks too, not only its yes/no.
 */
function mod(over: Partial<PlatformModule> = {}): PlatformModule {
  return {
    key: 'telemedicine',
    name: 'Telemedicine',
    category: 'health',
    lifecycle: 'active',
    readiness: 'ready',
    created_at: '2026-11-01T00:00:00Z',
    environments: {},
    env_flag_enabled: true,
    ...over,
  };
}
function published(status: ModuleStatus, over: Partial<PlatformModule> = {}): PlatformModule {
  return mod({ environments: { production: { environment: 'production', status } }, ...over });
}

describe('readinessOf', () => {
  it('reads a missing field as in_development, never as ready', () => {
    // A backend predating the column, or a database the migration has not reached.
    // Defaulting to 'ready' here would advertise a launch the server will refuse.
    expect(readinessOf(mod({ readiness: undefined }))).toBe('in_development');
    for (const r of ['in_development', 'testing', 'ready'] as ModuleReadiness[]) {
      expect(readinessOf(mod({ readiness: r }))).toBe(r);
    }
  });
});

describe('effectiveVisibility — production gates on readiness', () => {
  for (const r of ['in_development', 'testing', undefined] as (ModuleReadiness | undefined)[]) {
    it(`refuses production when readiness is ${r ?? '(absent)'}`, () => {
      const eff = effectiveVisibility(published('visible', { readiness: r }), 'production');
      expect(eff.visible).toBe(false);
      expect(eff.reason).toMatch(/ready/i);
    });
  }

  it('allows production once the module is ready', () => {
    const eff = effectiveVisibility(published('visible'), 'production');
    expect(eff).toEqual({ visible: true, reason: 'Live' });
  });

  it('leaves development and staging alone at any readiness', () => {
    // The point of the axis: unfinished work must stay reachable for testers.
    for (const r of ['in_development', 'testing'] as ModuleReadiness[]) {
      for (const env of ['development', 'staging'] as const) {
        const m = mod({ environments: { [env]: { environment: env, status: 'visible' } }, readiness: r });
        expect(effectiveVisibility(m, env).visible).toBe(true);
      }
    }
  });
});

describe('effectiveVisibility — the server check order', () => {
  it('archive outranks everything, including a not-ready module', () => {
    const eff = effectiveVisibility(
      published('visible', { lifecycle: 'archived', readiness: 'in_development' }),
      'production',
    );
    expect(eff.reason).toBe('Archived');
  });

  it('the ops kill switch outranks readiness', () => {
    // Naming the ops flag matters: an operator who sees "not ready" on a module they
    // KNOW is ready goes looking for the wrong owner.
    const eff = effectiveVisibility(
      published('visible', { env_flag: 'FEATURE_TELEMEDICINE_ENABLED', env_flag_enabled: false, readiness: 'testing' }),
      'production',
    );
    expect(eff.reason).toBe('Ops flag off (FEATURE_TELEMEDICINE_ENABLED)');
  });

  it('a tier nobody has decided on still reads never-published once it is ready', () => {
    expect(effectiveVisibility(mod({ readiness: 'ready' }), 'production').reason).toBe(
      'Never published here',
    );
  });
});
