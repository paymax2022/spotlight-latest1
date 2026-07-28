import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Beneficiary, getBeneficiaries, saveBeneficiary } from '@/api/beneficiaries.api';
import { ServiceType } from '@/types/billing';

/**
 * Saved beneficiaries for a given utility service, plus a save mutation that
 * refreshes the list on success. (BENE-1)
 */
export function useBeneficiaries(serviceType: ServiceType) {
  const queryClient = useQueryClient();
  const queryKey = ['beneficiaries', serviceType];

  const list = useQuery<Beneficiary[]>({
    queryKey,
    queryFn: () => getBeneficiaries(serviceType),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (input: {
      billerId: string;
      label: string;
      customerReference: string;
      customerName?: string;
    }) => saveBeneficiary({ serviceType, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return { list, save };
}
