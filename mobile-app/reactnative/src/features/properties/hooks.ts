import { useQuery } from '@tanstack/react-query';
import * as api from './api';

export const propertyKeys = { all: ['properties'] as const, list: () => [...propertyKeys.all, 'list'] as const };

export function useProperties() { return useQuery({ queryKey: propertyKeys.list(), queryFn: api.listProperties }); }
