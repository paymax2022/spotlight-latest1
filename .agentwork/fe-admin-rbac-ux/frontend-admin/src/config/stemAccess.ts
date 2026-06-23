const MANAGE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'OPERATIONS_MANAGER', 'CONTEST_MANAGER']);
const READ_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATIONS_MANAGER',
  'CONTEST_MANAGER',
  'SCHOOL_ADMIN',
  'TEACHER_COACH',
  'JUDGE',
  'MENTOR',
  'SPONSOR',
]);

export function getCurrentStemRole(): string {
  return (process.env.NEXT_PUBLIC_STEM_ROLE || 'ADMIN').toUpperCase();
}

export function canReadStem(role = getCurrentStemRole()): boolean {
  return READ_ROLES.has(role);
}

export function canManageStem(role = getCurrentStemRole()): boolean {
  return MANAGE_ROLES.has(role);
}

