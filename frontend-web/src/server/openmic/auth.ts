import { assertAdminPermission } from '@/src/server/admin/auth';

export function assertOpenMicAdmin(request: Request) {
  return assertAdminPermission(request, 'contests:manage');
}

export function assertOpenMicReadAdmin(request: Request) {
  return assertAdminPermission(request, 'applications:review');
}

export function assertOpenMicScoreAdmin(request: Request) {
  return assertAdminPermission(request, 'scores:manage');
}
