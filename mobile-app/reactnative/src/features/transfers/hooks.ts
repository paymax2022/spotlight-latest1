/**
 * Unified transfers feature — React Query hooks.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchBanks,
  resolveAccount,
  getPinStatus,
  createPin,
  verifyPin,
  walletToBankTransfer,
  bankToBankTransfer,
} from './api';
import type {
  WalletBankTransferInput,
  BankToBankTransferInput,
} from './types';

export function useBanks() {
  return useQuery({
    queryKey: ['transfers', 'banks'],
    queryFn: fetchBanks,
    staleTime: 24 * 60 * 60 * 1000, // banks rarely change
  });
}

export function usePinStatus() {
  return useQuery({
    queryKey: ['transfers', 'pin-status'],
    queryFn: getPinStatus,
    staleTime: 5 * 60 * 1000,
  });
}

export function useResolveAccount() {
  return useMutation({
    mutationFn: (vars: { bankCode: string; accountNumber: string; provider?: string }) =>
      resolveAccount(vars.bankCode, vars.accountNumber, vars.provider),
  });
}

export function useCreatePin() {
  return useMutation({ mutationFn: (pin: string) => createPin(pin) });
}

export function useVerifyPin() {
  return useMutation({ mutationFn: (pin: string) => verifyPin(pin) });
}

export function useWalletToBankTransfer() {
  return useMutation({
    mutationFn: (input: WalletBankTransferInput) => walletToBankTransfer(input),
  });
}

export function useBankToBankTransfer() {
  return useMutation({
    mutationFn: (input: BankToBankTransferInput) => bankToBankTransfer(input),
  });
}
