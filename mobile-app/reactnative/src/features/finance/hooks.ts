import { useQuery } from '@tanstack/react-query';
import * as api from './api';

export const financeKeys = { all: ['finance'] as const, dashboard: () => [...financeKeys.all, 'dashboard'] as const };

export function useFinanceDashboard() { return useQuery({ queryKey: financeKeys.dashboard(), queryFn: api.getFinanceDashboard }); }
