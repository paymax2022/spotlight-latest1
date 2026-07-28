// ── Association — Admin RBAC & member-action hooks (Q depth) ───────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyAdminAccess, suspendMember, restoreMember, transferMember, assignRole,
} from '../api/adminMembers.api';
import type { AdminRole } from '../types/adminRole.types';

const KEY = 'association';

export function useAdminAccess() {
  return useQuery({ queryKey: [KEY, 'adminAccess'], queryFn: getMyAdminAccess, staleTime: 5 * 60_000 });
}

function useMemberAction() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: [KEY, 'member', id] });
    qc.invalidateQueries({ queryKey: [KEY, 'directory'] });
    qc.invalidateQueries({ queryKey: [KEY, 'adminKpis'] });
  };
}

export function useSuspendMember() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => suspendMember(id, reason),
    onSuccess: (_d, { id }) => invalidate(id),
  });
}

export function useRestoreMember() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: (id: string) => restoreMember(id),
    onSuccess: (_d, id) => invalidate(id),
  });
}

export function useTransferMember() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: ({ id, chapter }: { id: string; chapter: string }) => transferMember(id, chapter),
    onSuccess: (_d, { id }) => invalidate(id),
  });
}

export function useAssignRole() {
  const invalidate = useMemberAction();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: AdminRole }) => assignRole(id, role),
    onSuccess: (_d, { id }) => invalidate(id),
  });
}
