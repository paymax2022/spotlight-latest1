import { useQuery } from '@tanstack/react-query';
import * as api from './api';

export const adminKeys = { all: ['estateadmin'] as const, summary: () => [...adminKeys.all, 'summary'] as const };

export function useAdminSummary() { return useQuery({ queryKey: adminKeys.summary(), queryFn: api.getAdminSummary }); }
