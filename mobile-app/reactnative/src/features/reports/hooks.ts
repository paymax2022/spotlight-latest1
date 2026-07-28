import { useQuery } from '@tanstack/react-query';
import * as api from './api';

export const reportKeys = { all: ['reports'] as const, list: () => [...reportKeys.all, 'list'] as const };

export function useReports() { return useQuery({ queryKey: reportKeys.list(), queryFn: api.getReports }); }
