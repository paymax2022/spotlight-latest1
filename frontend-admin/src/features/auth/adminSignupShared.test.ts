/**
 * Decision and validation logic behind /api/admin/signup.
 *
 * The endpoint that actually provisions accounts needs a service-role key, so
 * what is tested here is the part that decides whether provisioning may happen
 * at all and what input is acceptable — those are the security-relevant
 * branches, and they are pure on purpose so they can be tested without a
 * Supabase project.
 */
import { describe, expect, it } from 'vitest';
import {
  ADMIN_TIER_ROLE_SLUGS,
  MAX_PERMISSION_GRANTS,
  MIN_PASSWORD_LENGTH,
  MIN_SIGNUP_CODE_LENGTH,
  PROFILE_ROLE_FOR_ADMIN,
  classifySignupCode,
  constantTimeEqual,
  decodeJwtSubject,
  describeDisabledSignup,
  describeSignupMode,
  isAdminTierRoleSlug,
  isDuplicateEmailError,
  isSignupModeOpen,
  modeRequiresCode,
  normalizeEmail,
  normalizePermissionSlugs,
  resolveSignupMode,
  sanitizeSignupCode,
  splitFullName,
  validateSignupInput,
} from './adminSignupShared';

const base = {
  hasValidSession: false,
  signupCodeConfigured: false,
  consoleAdminCount: 3,
};

describe('resolveSignupMode', () => {
  it('fails closed when there is no session, no code, and admins already exist', () => {
    expect(resolveSignupMode(base)).toBe('disabled');
    expect(isSignupModeOpen('disabled')).toBe(false);
  });

  it('opens the bootstrap door only at zero admins', () => {
    expect(resolveSignupMode({ ...base, consoleAdminCount: 0 })).toBe('bootstrap');
  });

  it('never reads an unknown admin count as zero', () => {
    // A failed count query is null. Treating it as 0 would fling the bootstrap
    // door open on a console that has admins, every time the DB hiccups.
    expect(resolveSignupMode({ ...base, consoleAdminCount: null })).toBe('disabled');
  });

  it('prefers a verified session over every other state', () => {
    expect(resolveSignupMode({ ...base, hasValidSession: true, consoleAdminCount: 0 })).toBe('session');
    expect(resolveSignupMode({ ...base, hasValidSession: true, signupCodeConfigured: true })).toBe('session');
  });

  it('requires the code as soon as one is configured', () => {
    const mode = resolveSignupMode({ ...base, signupCodeConfigured: true, consoleAdminCount: 0 });
    expect(mode).toBe('code');
    expect(modeRequiresCode(mode)).toBe(true);
  });

  it('only asks for a code in code mode', () => {
    expect(modeRequiresCode('session')).toBe(false);
    expect(modeRequiresCode('bootstrap')).toBe(false);
    expect(modeRequiresCode('disabled')).toBe(false);
  });

  it('describes every mode', () => {
    for (const mode of ['session', 'code', 'bootstrap', 'disabled'] as const) {
      expect(describeSignupMode(mode).length).toBeGreaterThan(0);
    }
  });
});

describe('signup code strength', () => {
  it('rejects a code shorter than the minimum', () => {
    // The hole this closes: a 1-character ADMIN_SIGNUP_CODE used to switch the
    // public code path ON while being guessable in a handful of requests, so the
    // endpoint looked gated and was not.
    expect(classifySignupCode('hunter')).toBe('too-short');
    expect(sanitizeSignupCode('hunter')).toBe('');
  });

  it('treats a blank code as absent', () => {
    expect(classifySignupCode('')).toBe('absent');
    expect(classifySignupCode('   ')).toBe('absent');
    expect(sanitizeSignupCode('   ')).toBe('');
  });

  it('accepts a code at exactly the minimum and above', () => {
    const exact = 'a'.repeat(MIN_SIGNUP_CODE_LENGTH);
    expect(classifySignupCode(exact)).toBe('usable');
    expect(sanitizeSignupCode(exact)).toBe(exact);
  });

  it('measures the trimmed value and returns it trimmed', () => {
    const exact = 'a'.repeat(MIN_SIGNUP_CODE_LENGTH);
    expect(sanitizeSignupCode(`  ${exact}  `)).toBe(exact);
    expect(sanitizeSignupCode(`  ${'a'.repeat(MIN_SIGNUP_CODE_LENGTH - 1)}  `)).toBe('');
  });

  it('keeps an unusable code from opening code mode', () => {
    // route.ts feeds resolveSignupMode(signupCodeConfigured: codeState === 'usable'),
    // so asserted here is the consequence the endpoint depends on.
    expect(resolveSignupMode({ ...base, signupCodeConfigured: classifySignupCode('abc') === 'usable' })).toBe('disabled');
    expect(
      resolveSignupMode({ ...base, signupCodeConfigured: classifySignupCode('long-enough') === 'usable' }),
    ).toBe('code');
  });

  it('names a rejected code as too short rather than as missing', () => {
    const message = describeDisabledSignup('too-short');
    expect(message).toContain(String(MIN_SIGNUP_CODE_LENGTH));
    expect(message).not.toBe(describeSignupMode('disabled'));
  });

  it('falls back to the generic message when no code was rejected', () => {
    expect(describeDisabledSignup('absent')).toBe(describeSignupMode('disabled'));
    expect(describeDisabledSignup('usable')).toBe(describeSignupMode('disabled'));
  });
});

describe('constantTimeEqual', () => {
  it('matches identical strings', () => {
    expect(constantTimeEqual('correct-horse', 'correct-horse')).toBe(true);
  });

  it('rejects mismatches of equal length', () => {
    expect(constantTimeEqual('correct-horse', 'correct-horsf')).toBe(false);
  });

  it('rejects a prefix of the code', () => {
    expect(constantTimeEqual('correct-hors', 'correct-horse')).toBe(false);
  });

  it('rejects empty input against a real code', () => {
    expect(constantTimeEqual('', 'correct-horse')).toBe(false);
  });

  it('matches two empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('validateSignupInput', () => {
  const valid = {
    email: '  New.Admin@Example.COM ',
    password: 'correct-horse-9',
    fullName: '  New   Admin ',
    roleSlug: 'super-admin',
    permissionSlugs: ['users.view'],
    setupCode: 'x',
  };

  it('accepts a well-formed payload and normalizes it', () => {
    const result = validateSignupInput(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.email).toBe('new.admin@example.com');
    expect(result.value.fullName).toBe('New Admin');
    expect(result.value.roleSlug).toBe('super-admin');
  });

  it('requires an email', () => {
    expect(validateSignupInput({ ...valid, email: '   ' })).toEqual({
      ok: false,
      error: 'An email address is required.',
    });
  });

  it('rejects malformed emails', () => {
    for (const email of ['admin', 'admin@', '@example.com', 'a b@example.com', 'admin@example']) {
      expect(validateSignupInput({ ...valid, email }).ok).toBe(false);
    }
  });

  it('rejects a password shorter than the minimum', () => {
    const result = validateSignupInput({ ...valid, password: 'short9' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('requires a letter and a digit', () => {
    expect(validateSignupInput({ ...valid, password: 'letters-only-here' }).ok).toBe(false);
    expect(validateSignupInput({ ...valid, password: '1234567890123' }).ok).toBe(false);
  });

  it('accepts a password that meets every rule', () => {
    expect(validateSignupInput({ ...valid, password: 'correct-horse-9' }).ok).toBe(true);
  });

  it('rejects a role outside the admin tier', () => {
    for (const roleSlug of ['admin', 'judge', 'registered-user', '', 'SUPER-ADMIN']) {
      expect(validateSignupInput({ ...valid, roleSlug }).ok).toBe(false);
    }
  });

  it('accepts every admin-tier slug', () => {
    for (const roleSlug of ADMIN_TIER_ROLE_SLUGS) {
      expect(validateSignupInput({ ...valid, roleSlug }).ok).toBe(true);
    }
  });

  it('ignores non-string permission entries', () => {
    const result = validateSignupInput({ ...valid, permissionSlugs: [1, null, 'users.view'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.permissionSlugs).toEqual(['users.view']);
  });

  it('treats a missing body as invalid rather than throwing', () => {
    expect(validateSignupInput(undefined).ok).toBe(false);
    expect(validateSignupInput(null).ok).toBe(false);
  });
});

describe('normalizePermissionSlugs', () => {
  it('trims and keeps slugs — existence is the database\'s call, not this list\'s', () => {
    expect(normalizePermissionSlugs([' users.view ', 'made.up.slug'])).toEqual(['users.view', 'made.up.slug']);
  });

  it('de-duplicates repeated slugs', () => {
    expect(normalizePermissionSlugs(['users.view', 'users.view'])).toEqual(['users.view']);
  });

  it('drops non-strings and blanks', () => {
    expect(normalizePermissionSlugs([null, 7, '', '  ', 'users.view'])).toEqual(['users.view']);
  });

  it('caps the number of grants', () => {
    const many = Array.from({ length: MAX_PERMISSION_GRANTS + 25 }, (_, i) => `p${i}`);
    expect(normalizePermissionSlugs(many)).toHaveLength(MAX_PERMISSION_GRANTS);
  });

  it('returns nothing for a non-array', () => {
    expect(normalizePermissionSlugs('users.view')).toEqual([]);
    expect(normalizePermissionSlugs(undefined)).toEqual([]);
  });
});

describe('splitFullName', () => {
  it('splits on the first space', () => {
    expect(splitFullName('a@example.com', 'Ada Lovelace King')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace King',
    });
  });

  it('uses the email local part when no name is given', () => {
    expect(splitFullName('ops@example.com', '   ')).toEqual({ firstName: 'ops', lastName: 'Admin' });
  });

  it('leaves the last name empty for a single-word name', () => {
    // platform_users.last_name is NOT NULL but may be empty — never null.
    expect(splitFullName('a@example.com', 'Ada')).toEqual({ firstName: 'Ada', lastName: '' });
  });
});

describe('small helpers', () => {
  it('recognizes the admin-tier roles and their profile role', () => {
    expect(isAdminTierRoleSlug('super-admin')).toBe(true);
    expect(isAdminTierRoleSlug('judge')).toBe(false);
    expect(PROFILE_ROLE_FOR_ADMIN).toBe('admin');
  });

  it('lowercases and trims emails', () => {
    expect(normalizeEmail('  Admin@Example.COM ')).toBe('admin@example.com');
  });

  it('matches the duplicate-email wordings GoTrue has used', () => {
    expect(isDuplicateEmailError('User already registered')).toBe(true);
    expect(isDuplicateEmailError('A user with this email address has already been registered')).toBe(true);
    expect(isDuplicateEmailError('email_exists')).toBe(true);
    expect(isDuplicateEmailError('Database error saving new user')).toBe(false);
  });

  it('reads the subject out of a token without trusting it', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256' })}.${encode({ sub: 'user-1', exp: 1 })}.sig`;
    expect(decodeJwtSubject(token)).toBe('user-1');
    expect(decodeJwtSubject(undefined)).toBeNull();
    expect(decodeJwtSubject('not-a-jwt')).toBeNull();
    expect(decodeJwtSubject(`${encode({})}.${encode({})}.sig`)).toBeNull();
  });
});
