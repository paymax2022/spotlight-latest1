import { assertAdminPermission } from '@/src/server/admin/auth';

export function assertStemAdmin(request: Request) {
  return assertAdminPermission(request, 'contests:manage');
}

export function assertStemReadAdmin(request: Request) {
  return assertAdminPermission(request, 'applications:review');
}

export function assertStemScoreAdmin(request: Request) {
  return assertAdminPermission(request, 'scores:manage');
}
